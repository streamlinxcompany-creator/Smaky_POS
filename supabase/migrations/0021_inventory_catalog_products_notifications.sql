-- Inventory v13.1: separate catalog merchandise stock, low-stock notifications,
-- transactional sale deduction, and cascade cleanup when a catalog product is removed.
begin;

alter table public.inventory_items
  add column if not exists record_kind text not null default 'ingredient';
alter table public.inventory_items
  add column if not exists catalog_product_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_items_record_kind_check'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint inventory_items_record_kind_check
      check (record_kind in ('ingredient','catalog_product'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'inventory_items_catalog_product_fk'
      and conrelid = 'public.inventory_items'::regclass
  ) then
    alter table public.inventory_items
      add constraint inventory_items_catalog_product_fk
      foreign key (catalog_product_id) references public.products(id) on delete restrict;
  end if;
end;
$$;

create unique index if not exists idx_inventory_items_catalog_product_unique
  on public.inventory_items(catalog_product_id)
  where record_kind = 'catalog_product' and catalog_product_id is not null;
create index if not exists idx_inventory_items_record_kind_active
  on public.inventory_items(record_kind, active, name);

create or replace function public.inventory_link_catalog_product(
  p_product_id text,
  p_initial_quantity numeric,
  p_low_stock_quantity numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_product public.products%rowtype;
  v_item public.inventory_items%rowtype;
  v_initial numeric(18,6) := coalesce(p_initial_quantity, 0);
  v_low numeric(18,6);
  v_now timestamptz := now();
begin
  if not coalesce((select private.is_active_user()), false)
     or not coalesce((select private.has_permission('inventory.manage')), false) then
    raise exception 'No tienes permiso para administrar inventario.' using errcode = '42501';
  end if;
  if coalesce(trim(p_product_id),'') = '' then
    raise exception 'Selecciona un producto del catálogo.' using errcode = '22023';
  end if;
  if p_low_stock_quantity is not null and p_low_stock_quantity < 0 then
    raise exception 'El mínimo de existencias no puede ser negativo.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory-catalog-product:' || trim(p_product_id)));
  select * into v_product
  from public.products
  where id = trim(p_product_id) and active = true and deleted_at is null
  for update;
  if not found then
    raise exception 'El producto no existe, está inactivo o fue eliminado del catálogo.' using errcode = '22023';
  end if;
  select * into v_item
  from public.inventory_items
  where catalog_product_id = v_product.id and record_kind = 'catalog_product'
  for update;
  if found then return to_jsonb(v_item); end if;

  if p_low_stock_quantity is not null then v_low := p_low_stock_quantity; end if;
  select * into v_profile from public.profiles where id = (select auth.uid()) and active = true;
  insert into public.inventory_items(
    id, name, category, unit, unit_kind, base_unit, unit_factor,
    stock_base, low_stock_base, active, note, created_at, updated_at,
    created_by, created_by_name, record_kind, catalog_product_id
  ) values (
    gen_random_uuid()::text, v_product.name, coalesce(v_product.category,''), 'unidad', 'custom', 'unidad', 1,
    v_initial, v_low, true, '', v_now, v_now,
    coalesce(v_profile.id::text, (select auth.uid())::text), coalesce(v_profile.name,''), 'catalog_product', v_product.id
  ) returning * into v_item;

  if v_initial <> 0 then
    insert into public.inventory_movements(
      id, inventory_item_id, item_name, movement_type, quantity_base, display_quantity, display_unit,
      stock_before_base, stock_after_base, reason, occurred_at, actor_id, actor_name, dedupe_key
    ) values (
      gen_random_uuid()::text, v_item.id, v_item.name, 'initial_stock', v_initial, v_initial, 'unidad',
      0, v_initial, 'Existencia inicial de producto de catálogo', v_now,
      coalesce(v_profile.id::text, (select auth.uid())::text), coalesce(v_profile.name,''),
      'catalog-initial:' || v_product.id
    );
  end if;
  return to_jsonb(v_item);
end;
$$;

-- Catalog products are soft-deleted by the existing POS. When that happens,
-- remove their linked stock, inventory ledger, recipe rows and combo references.
create or replace function public.inventory_cleanup_deleted_catalog_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id text;
begin
  if old.deleted_at is null and new.deleted_at is not null then
    for v_item_id in
      select id from public.inventory_items
      where catalog_product_id = new.id and record_kind = 'catalog_product'
      for update
    loop
      delete from public.inventory_movements where inventory_item_id = v_item_id;
      delete from public.inventory_recipes where inventory_item_id = v_item_id;
      delete from public.inventory_items where id = v_item_id and record_kind = 'catalog_product';
    end loop;
    delete from public.inventory_recipes where product_id = new.id;
    delete from public.inventory_recipe_products where product_id = new.id or component_product_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.inventory_cleanup_deleted_catalog_product() from public, anon, authenticated;
drop trigger if exists products_inventory_cleanup_after_soft_delete on public.products;
create trigger products_inventory_cleanup_after_soft_delete
  after update of deleted_at on public.products
  for each row execute function public.inventory_cleanup_deleted_catalog_product();

create or replace function public.inventory_delete_catalog_product(p_product_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
begin
  if not coalesce((select private.is_active_user()), false)
     or not coalesce((select private.has_permission('products.manage')), false) then
    raise exception 'No tienes permiso para eliminar productos del catálogo.' using errcode = '42501';
  end if;
  update public.products
    set deleted_at = coalesce(deleted_at, now()),
        deleted_by = coalesce(deleted_by, (select auth.uid())::text),
        updated_at = now()
    where id = trim(coalesce(p_product_id,''))
    returning * into v_product;
  if not found then
    raise exception 'El producto no existe en el catálogo.' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', v_product.id, 'deleted_at', v_product.deleted_at, 'ok', true);
end;
$$;
revoke all on function public.inventory_link_catalog_product(text,numeric,numeric) from public, anon;
revoke all on function public.inventory_delete_catalog_product(text) from public, anon;
grant execute on function public.inventory_link_catalog_product(text,numeric,numeric) to authenticated;
grant execute on function public.inventory_delete_catalog_product(text) to authenticated;

-- Stock of a finished/catalog item is reduced by the sale itself and by the
-- component quantity when that item is included within a combo.
create or replace function public.inventory_apply_catalog_sale_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_need numeric(18,6);
  v_before numeric(18,6);
  v_after numeric(18,6);
  v_dedupe text;
  v_cycle text := coalesce(new.updated_at, new.created_at, now())::text;
  v_ledger_started_at timestamptz;
begin
  select ledger_started_at into v_ledger_started_at
  from public.inventory_control where id = 'global';

  if new.deleted_at is not null
     or new.created_at < coalesce(v_ledger_started_at, now()) then
    return new;
  end if;

  for v_line in
    with recursive sale_lines as (
      select si.ordinality::integer as line_no,
        coalesce(si.item->>'productId', si.item->>'product_id') as root_product_id,
        coalesce(si.item->>'name','Producto') as root_product_name,
        greatest(coalesce(nullif(si.item->>'quantity','')::numeric,0),0) as sold_quantity
      from jsonb_array_elements(
        case when jsonb_typeof(coalesce(new.data->'items','[]'::jsonb)) = 'array'
          then coalesce(new.data->'items','[]'::jsonb) else '[]'::jsonb end
      ) with ordinality as si(item, ordinality)
    ), product_tree(line_no, root_product_id, root_product_name, sold_quantity, current_product_id, multiplier, path) as (
      select line.line_no, line.root_product_id, line.root_product_name, line.sold_quantity,
        line.root_product_id, 1::numeric(18,6), array[line.root_product_id]::text[]
      from sale_lines line
      where line.root_product_id is not null and line.sold_quantity > 0
      union all
      select tree.line_no, tree.root_product_id, tree.root_product_name, tree.sold_quantity,
        component.component_product_id, (tree.multiplier * component.quantity)::numeric(18,6), tree.path || component.component_product_id
      from product_tree tree
      join public.inventory_recipe_products component on component.product_id = tree.current_product_id
      where not (component.component_product_id = any(tree.path))
    ), required_products as (
      select tree.line_no, tree.root_product_id, tree.root_product_name,
        max(tree.sold_quantity)::numeric(18,6) as sold_quantity,
        tree.current_product_id, sum(tree.multiplier)::numeric(18,6) as multiplier
      from product_tree tree
      group by tree.line_no, tree.root_product_id, tree.root_product_name, tree.current_product_id
    )
    select required_products.line_no, required_products.root_product_id,
      required_products.root_product_name, required_products.sold_quantity,
      item.id as inventory_item_id, item.name as item_name, item.unit, item.unit_factor,
      required_products.current_product_id, required_products.multiplier
    from required_products
    join public.inventory_items item
      on item.catalog_product_id = required_products.current_product_id
      and item.record_kind = 'catalog_product' and item.active = true
    order by required_products.line_no, item.id
  loop
    v_need := round(v_line.sold_quantity * v_line.multiplier, 6);
    if v_need <= 0 then continue; end if;
    v_dedupe := 'sale:' || new.id || ':cycle:' || v_cycle || ':line:' || v_line.line_no::text || ':catalog:' || v_line.current_product_id;
    if exists (select 1 from public.inventory_movements where dedupe_key = v_dedupe) then continue; end if;
    update public.inventory_items
      set stock_base = stock_base - v_need, updated_at = now()
      where id = v_line.inventory_item_id and record_kind = 'catalog_product'
      returning stock_base into v_after;
    if not found then continue; end if;
    v_before := v_after + v_need;
    insert into public.inventory_movements(
      id, inventory_item_id, item_name, movement_type, quantity_base, display_quantity, display_unit,
      stock_before_base, stock_after_base, reason, occurred_at, actor_id, actor_name,
      sale_id, sale_order_number, sale_total, sale_payment, sale_snapshot,
      product_id, product_name, sold_product_quantity, sale_line_index, dedupe_key
    ) values (
      gen_random_uuid()::text, v_line.inventory_item_id, v_line.item_name, 'sale_consumption', -v_need, -v_need,
      v_line.unit, v_before, v_after, 'Venta de producto de catálogo', coalesce(new.created_at, now()),
      new.data->>'userId', coalesce(new.data->>'userName',''), new.id, new.order_number, new.total, new.payment,
      coalesce(new.data,'{}'::jsonb), v_line.root_product_id, v_line.root_product_name,
      v_line.sold_quantity, v_line.line_no, v_dedupe
    );
  end loop;
  return new;
end;
$$;
revoke all on function public.inventory_apply_catalog_sale_stock() from public, anon, authenticated;
drop trigger if exists sales_inventory_catalog_stock_after_insert on public.sales;
create trigger sales_inventory_catalog_stock_after_insert
  after insert on public.sales
  for each row execute function public.inventory_apply_catalog_sale_stock();


-- Restore catalog-product stock when a sale is soft-deleted. The original
-- sale snapshot remains in sales; only the linked merchandise stock is restored.
create or replace function public.inventory_reverse_catalog_sale_stock(p_sale_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_move public.inventory_movements%rowtype;
  v_before numeric(18,6);
  v_after numeric(18,6);
begin
  for v_move in
    select m.*
    from public.inventory_movements m
    join public.inventory_items i on i.id = m.inventory_item_id
    where m.sale_id = p_sale_id
      and m.movement_type = 'sale_consumption'
      and i.record_kind = 'catalog_product'
      and not exists (
        select 1 from public.inventory_movements rev where rev.reversal_of = m.id
      )
    order by m.inventory_item_id, m.id
    for update of m
  loop
    update public.inventory_items
      set stock_base = stock_base - v_move.quantity_base, updated_at = now()
      where id = v_move.inventory_item_id and record_kind = 'catalog_product'
      returning stock_base into v_after;
    if not found then continue; end if;
    v_before := v_after + v_move.quantity_base;
    insert into public.inventory_movements(
      id, inventory_item_id, item_name, movement_type, quantity_base, display_quantity, display_unit,
      stock_before_base, stock_after_base, reason, occurred_at, actor_id, actor_name,
      sale_id, sale_order_number, sale_total, sale_payment, sale_snapshot,
      product_id, product_name, sold_product_quantity, sale_line_index, dedupe_key, reversal_of
    ) values (
      gen_random_uuid()::text, v_move.inventory_item_id, v_move.item_name, 'sale_reversal', -v_move.quantity_base,
      -v_move.display_quantity, v_move.display_unit, v_before, v_after, 'Reversión por venta eliminada', now(),
      v_move.actor_id, v_move.actor_name, v_move.sale_id, v_move.sale_order_number, v_move.sale_total,
      v_move.sale_payment, v_move.sale_snapshot, v_move.product_id, v_move.product_name,
      v_move.sold_product_quantity, v_move.sale_line_index, 'catalog-reversal:' || v_move.id, v_move.id
    );
  end loop;
end;
$$;
revoke all on function public.inventory_reverse_catalog_sale_stock(text) from public, anon, authenticated;

create or replace function public.inventory_catalog_sale_deleted_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    perform public.inventory_reverse_catalog_sale_stock(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.inventory_catalog_sale_deleted_trigger() from public, anon, authenticated;

drop trigger if exists sales_inventory_catalog_stock_after_soft_delete on public.sales;
create trigger sales_inventory_catalog_stock_after_soft_delete
  after update of deleted_at on public.sales
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.inventory_catalog_sale_deleted_trigger();

-- Extend the pre-sale shortage check to include standalone products tracked in
-- the product tab. This is only a warning; sale registration is never blocked.
create or replace function public.inventory_check_sale_shortages(p_items jsonb)
returns table(
  inventory_item_id text,
  item_name text,
  display_unit text,
  available_quantity numeric,
  required_quantity numeric,
  shortage_quantity numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce((select private.is_active_user()), false)
     or not coalesce((select private.has_permission('pos.access')), false) then
    raise exception 'No tienes permiso para consultar el inventario del cobro.' using errcode = '42501';
  end if;

  return query
  with recursive sale_lines as (
    select
      coalesce(line.item->>'productId', line.item->>'product_id') as root_product_id,
      greatest(coalesce(nullif(line.item->>'quantity', '')::numeric, 0), 0)::numeric(18,6) as quantity
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_items, '[]'::jsonb)) = 'array'
        then coalesce(p_items, '[]'::jsonb) else '[]'::jsonb end
    ) as line(item)
  ), product_tree(root_product_id, current_product_id, multiplier, path) as (
    select sale_lines.root_product_id, sale_lines.root_product_id, sale_lines.quantity,
      array[sale_lines.root_product_id]::text[]
    from sale_lines where sale_lines.root_product_id is not null and sale_lines.quantity > 0
    union all
    select tree.root_product_id, component.component_product_id,
      (tree.multiplier * component.quantity)::numeric(18,6), tree.path || component.component_product_id
    from product_tree tree
    join public.inventory_recipe_products component on component.product_id = tree.current_product_id
    where not (component.component_product_id = any(tree.path))
  ), ingredient_required as (
    select item.id, item.name, item.unit, item.unit_factor, item.stock_base,
      sum(tree.multiplier * recipe.quantity_base)::numeric(18,6) as required_base
    from product_tree tree
    join public.inventory_recipes recipe on recipe.product_id = tree.current_product_id
    join public.inventory_items item on item.id = recipe.inventory_item_id
      and item.active = true and item.record_kind = 'ingredient'
    group by item.id, item.name, item.unit, item.unit_factor, item.stock_base
  ), product_required as (
    select item.id, item.name, item.unit, item.unit_factor, item.stock_base,
      sum(tree.multiplier)::numeric(18,6) as required_base
    from product_tree tree
    join public.inventory_items item on item.catalog_product_id = tree.current_product_id
      and item.active = true and item.record_kind = 'catalog_product'
    group by item.id, item.name, item.unit, item.unit_factor, item.stock_base
  ), all_required as (
    select * from ingredient_required
    union all
    select * from product_required
  )
  select req.id, req.name, req.unit,
    round(req.stock_base / req.unit_factor, 6),
    round(req.required_base / req.unit_factor, 6),
    round((req.required_base - req.stock_base) / req.unit_factor, 6)
  from all_required req
  where req.stock_base < req.required_base
  order by req.name;
end;
$$;
revoke all on function public.inventory_check_sale_shortages(jsonb) from public, anon;
grant execute on function public.inventory_check_sale_shortages(jsonb) to authenticated;

-- Add inventory tables to Realtime for prompt cross-device refresh.
do $$
declare
  target_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach target_table in array array[
      'inventory_items',
      'inventory_recipes',
      'inventory_recipe_products',
      'inventory_movements'
    ] loop
      if to_regclass(format('public.%I', target_table)) is not null
         and not exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime'
             and schemaname = 'public'
             and tablename = target_table
         ) then
        execute format('alter publication supabase_realtime add table public.%I', target_table);
      end if;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
