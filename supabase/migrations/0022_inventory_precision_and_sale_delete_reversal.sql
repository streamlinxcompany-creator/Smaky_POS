-- Inventory v13.1.1: normalize stock quantities to 3 decimal places and restore
-- stock for sales that are physically deleted, not only soft-deleted.
-- Soft-delete reversals are still handled by migrations 0020/0021; reversal_of
-- makes these operations idempotent so a later physical purge cannot restore twice.
begin;

-- Normalize existing stock values that contain floating-point-like dust such as
-- 1.00001 or 0.00001. Quantities remain fractional to three decimal places.
update public.inventory_items
set stock_base = round(stock_base, 3),
    low_stock_base = case when low_stock_base is null then null else round(low_stock_base, 3) end,
    updated_at = now()
where stock_base is distinct from round(stock_base, 3)
   or low_stock_base is distinct from case when low_stock_base is null then null else round(low_stock_base, 3) end;

-- Recipe inputs are precise to three decimal places. Recompute base quantities
-- from the rounded display value so the recipe and its configured unit agree.
-- Drop only sub-thousandth recipe rows that cannot represent a real configured
-- quantity at the new precision (e.g. 0.00001); these were the source of dust
-- movements such as 0.00001 and 1.00001.
delete from public.inventory_recipes
where round(quantity_display, 3) <= 0;
update public.inventory_recipes
set quantity_display = round(quantity_display, 3),
    quantity_base = round(round(quantity_display, 3) * quantity_factor, 3),
    updated_at = now()
where quantity_display is distinct from round(quantity_display, 3)
   or quantity_base is distinct from round(round(quantity_display, 3) * quantity_factor, 3);

delete from public.inventory_recipe_products
where round(quantity, 3) <= 0;
update public.inventory_recipe_products
set quantity = round(quantity, 3), updated_at = now()
where quantity is distinct from round(quantity, 3);

create or replace function public.inventory_normalize_stock_precision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.stock_base := round(coalesce(new.stock_base, 0), 3);
  if new.low_stock_base is not null then
    new.low_stock_base := round(new.low_stock_base, 3);
  end if;
  return new;
end;
$$;
revoke all on function public.inventory_normalize_stock_precision() from public, anon, authenticated;
drop trigger if exists inventory_items_normalize_stock_precision on public.inventory_items;
create trigger inventory_items_normalize_stock_precision
before insert or update on public.inventory_items
for each row execute function public.inventory_normalize_stock_precision();

create or replace function public.inventory_normalize_recipe_precision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.quantity_display := round(new.quantity_display, 3);
  if new.quantity_display <= 0 then
    raise exception 'La cantidad de consumo debe ser al menos 0,001.' using errcode = '22023';
  end if;
  new.quantity_factor := coalesce(new.quantity_factor, 1);
  new.quantity_base := round(new.quantity_display * new.quantity_factor, 3);
  if new.quantity_base <= 0 then
    raise exception 'La cantidad convertida debe ser mayor que cero.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.inventory_normalize_recipe_precision() from public, anon, authenticated;
drop trigger if exists inventory_recipes_normalize_precision on public.inventory_recipes;
create trigger inventory_recipes_normalize_precision
before insert or update on public.inventory_recipes
for each row execute function public.inventory_normalize_recipe_precision();

create or replace function public.inventory_normalize_recipe_product_precision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.quantity := round(new.quantity, 3);
  if new.quantity <= 0 then
    raise exception 'La cantidad del producto incluido debe ser al menos 0,001.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public.inventory_normalize_recipe_product_precision() from public, anon, authenticated;
drop trigger if exists inventory_recipe_products_normalize_precision on public.inventory_recipe_products;
create trigger inventory_recipe_products_normalize_precision
before insert or update on public.inventory_recipe_products
for each row execute function public.inventory_normalize_recipe_product_precision();

create or replace function public.inventory_normalize_movement_precision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.quantity_base := round(new.quantity_base, 3);
  new.display_quantity := round(new.display_quantity, 3);
  new.stock_before_base := round(new.stock_before_base, 3);
  new.stock_after_base := round(new.stock_after_base, 3);
  if new.sold_product_quantity is not null then
    new.sold_product_quantity := round(new.sold_product_quantity, 3);
  end if;
  return new;
end;
$$;
revoke all on function public.inventory_normalize_movement_precision() from public, anon, authenticated;
drop trigger if exists inventory_movements_normalize_precision on public.inventory_movements;
create trigger inventory_movements_normalize_precision
before insert or update on public.inventory_movements
for each row execute function public.inventory_normalize_movement_precision();

-- Replace the manual movement RPC to round and validate at the database boundary,
-- not merely in the browser. This also makes retries exactly idempotent.
create or replace function public.inventory_apply_movement(
  p_movement_id text,
  p_item_id text,
  p_quantity numeric,
  p_movement_type text,
  p_reason text,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_item public.inventory_items%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_quantity numeric(18,3) := round(coalesce(p_quantity, 0), 3);
  v_delta numeric(18,3);
  v_before numeric(18,3);
  v_after numeric(18,3);
  v_kind text := lower(trim(coalesce(p_movement_type,'')));
  v_reason text := trim(coalesce(p_reason,''));
  v_at timestamptz := coalesce(p_occurred_at, now());
begin
  if not coalesce((select private.is_active_user()), false)
     or not coalesce((select private.has_permission('inventory.manage')), false) then
    raise exception 'No tienes permiso para modificar existencias.' using errcode = '42501';
  end if;
  if coalesce(p_movement_id,'') = '' or coalesce(p_item_id,'') = '' then
    raise exception 'Faltan datos del movimiento.' using errcode = '22023';
  end if;
  if v_quantity <= 0 then
    raise exception 'La cantidad debe ser al menos 0,001.' using errcode = '22023';
  end if;
  if v_kind not in ('entry','exit') then raise exception 'Tipo de movimiento no válido.' using errcode = '22023'; end if;
  if v_reason = '' then raise exception 'Indica el motivo del movimiento.' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtext('inventory-movement:' || p_movement_id));
  select * into v_existing from public.inventory_movements where id = p_movement_id;
  if found then return to_jsonb(v_existing); end if;

  select * into v_item from public.inventory_items where id = p_item_id and active = true for update;
  if not found then raise exception 'El ingrediente no existe o está archivado.' using errcode = 'P0002'; end if;

  v_delta := round(v_quantity * v_item.unit_factor * case when v_kind = 'entry' then 1 else -1 end, 3);
  v_before := round(v_item.stock_base, 3);
  v_after := round(v_before + v_delta, 3);
  update public.inventory_items set stock_base = v_after, updated_at = now()
    where id = v_item.id returning stock_base into v_after;
  select * into v_profile from public.profiles where id = (select auth.uid()) and active = true;

  insert into public.inventory_movements(
    id, inventory_item_id, item_name, movement_type, quantity_base, display_quantity, display_unit,
    stock_before_base, stock_after_base, reason, occurred_at, actor_id, actor_name, dedupe_key
  ) values (
    p_movement_id, v_item.id, v_item.name, v_kind, v_delta, round(v_delta / v_item.unit_factor, 3), v_item.unit,
    v_before, v_after, v_reason, v_at,
    coalesce(v_profile.id::text, (select auth.uid())::text), coalesce(v_profile.name,''), 'manual:' || p_movement_id
  ) returning * into v_existing;
  return to_jsonb(v_existing);
end;
$$;
revoke all on function public.inventory_apply_movement(text,text,numeric,text,text,timestamptz) from public, anon;
grant execute on function public.inventory_apply_movement(text,text,numeric,text,text,timestamptz) to authenticated;

-- Recalculate reversals from the actual current stock inside the row lock. This
-- is exact to three decimals and remains safe if multiple devices delete at once.
create or replace function public.inventory_reverse_sale_consumption(p_sale_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_move public.inventory_movements%rowtype;
  v_before numeric(18,3);
  v_after numeric(18,3);
  v_restore numeric(18,3);
begin
  for v_move in
    select m.*
    from public.inventory_movements m
    where m.sale_id = p_sale_id
      and m.movement_type = 'sale_consumption'
      and not exists (select 1 from public.inventory_movements rev where rev.reversal_of = m.id)
    order by m.inventory_item_id, m.id
    for update
  loop
    v_restore := round(-v_move.quantity_base, 3);
    if v_restore <= 0 then continue; end if;

    select i.stock_base into v_before
    from public.inventory_items i
    where i.id = v_move.inventory_item_id
    for update;
    if not found then continue; end if;

    v_before := round(v_before, 3);
    v_after := round(v_before + v_restore, 3);
    update public.inventory_items
      set stock_base = v_after, updated_at = now()
      where id = v_move.inventory_item_id
      returning stock_base into v_after;

    insert into public.inventory_movements(
      id, inventory_item_id, item_name, movement_type, quantity_base, display_quantity, display_unit,
      stock_before_base, stock_after_base, reason, occurred_at, actor_id, actor_name,
      sale_id, sale_order_number, sale_total, sale_payment, sale_snapshot,
      product_id, product_name, sold_product_quantity, sale_line_index, dedupe_key, reversal_of
    ) values (
      gen_random_uuid()::text, v_move.inventory_item_id, v_move.item_name, 'sale_reversal', v_restore,
      round(-v_move.display_quantity, 3), v_move.display_unit, v_before, v_after,
      'Reversión de inventario por venta eliminada', now(), v_move.actor_id, v_move.actor_name,
      v_move.sale_id, v_move.sale_order_number, v_move.sale_total, v_move.sale_payment,
      v_move.sale_snapshot, v_move.product_id, v_move.product_name, v_move.sold_product_quantity,
      v_move.sale_line_index, 'reversal:' || v_move.id, v_move.id
    );
  end loop;
end;
$$;
revoke all on function public.inventory_reverse_sale_consumption(text) from public, anon, authenticated;

-- A normal deletion in Sales marks deleted_at and is already reversed by the
-- UPDATE trigger. StreamLinx purges and POS reset physically DELETE rows, so
-- handle those too. The movement reversal_of unique key makes this safe if an
-- earlier soft-delete already reversed the sale.
create or replace function public.inventory_sales_physical_delete_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.inventory_reverse_sale_consumption(old.id);
  perform public.inventory_reverse_catalog_sale_stock(old.id);
  return old;
end;
$$;
revoke all on function public.inventory_sales_physical_delete_trigger() from public, anon, authenticated;
drop trigger if exists sales_inventory_recompose_after_physical_delete on public.sales;
create trigger sales_inventory_recompose_after_physical_delete
after delete on public.sales
for each row execute function public.inventory_sales_physical_delete_trigger();

-- Repair historical sales that were soft-deleted or physically purged before
-- this migration, but whose inventory consumption did not yet have a reversal.
do $$
declare
  v_sale_id text;
begin
  for v_sale_id in
    select distinct m.sale_id
    from public.inventory_movements m
    left join public.sales s on s.id = m.sale_id
    where m.movement_type = 'sale_consumption'
      and m.sale_id is not null
      and (s.id is null or s.deleted_at is not null)
      and not exists (
        select 1 from public.inventory_movements rev where rev.reversal_of = m.id
      )
  loop
    perform public.inventory_reverse_sale_consumption(v_sale_id);
    perform public.inventory_reverse_catalog_sale_stock(v_sale_id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
