-- Smaky POS v13.1.2: discrete/custom units are counted as whole numbers.
-- Weight and volume units (kg/g/L/ml) still accept fractional quantities.
-- This validates both the UI path and direct RPC calls.
begin;

create or replace function public.inventory_create_item(
  p_id text,
  p_name text,
  p_category text,
  p_unit text,
  p_initial_quantity numeric,
  p_low_stock_quantity numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_item public.inventory_items%rowtype;
  v_unit text := trim(coalesce(p_unit, ''));
  v_name text := trim(coalesce(p_name, ''));
  v_kind text := 'custom';
  v_base_unit text;
  v_factor numeric(18,6) := 1;
  v_initial numeric(18,6) := coalesce(p_initial_quantity, 0);
  v_low numeric(18,6);
  v_now timestamptz := now();
begin
  if not coalesce((select private.is_active_user()), false)
     or not coalesce((select private.has_permission('inventory.manage')), false) then
    raise exception 'No tienes permiso para administrar inventario.' using errcode = '42501';
  end if;
  if v_name = '' or v_unit = '' or coalesce(p_id, '') = '' then
    raise exception 'Nombre, unidad e identificador son obligatorios.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory-create:' || p_id));
  select * into v_item from public.inventory_items where id = p_id;
  if found then return to_jsonb(v_item); end if;

  case lower(v_unit)
    when 'kg', 'kilogramo', 'kilogramos' then v_kind := 'mass'; v_base_unit := 'g'; v_factor := 1000;
    when 'g', 'gramo', 'gramos' then v_kind := 'mass'; v_base_unit := 'g'; v_factor := 1;
    when 'l', 'litro', 'litros' then v_kind := 'volume'; v_base_unit := 'ml'; v_factor := 1000;
    when 'ml', 'mililitro', 'mililitros' then v_kind := 'volume'; v_base_unit := 'ml'; v_factor := 1;
    else v_kind := 'custom'; v_base_unit := v_unit; v_factor := 1;
  end case;
  if v_kind = 'custom' and v_initial <> trunc(v_initial) then
    raise exception 'Esta unidad se cuenta en números enteros: usa 1, 2, 3…' using errcode = '22023';
  end if;
  if v_kind = 'custom' and p_low_stock_quantity is not null and p_low_stock_quantity <> trunc(p_low_stock_quantity) then
    raise exception 'El nivel de alerta para esta unidad debe ser un número entero.' using errcode = '22023';
  end if;
  if p_low_stock_quantity is not null then
    if p_low_stock_quantity < 0 then raise exception 'El mínimo de existencias no puede ser negativo.' using errcode = '22023'; end if;
    v_low := p_low_stock_quantity * v_factor;
  end if;
  select * into v_profile from public.profiles where id = (select auth.uid()) and active = true;
  insert into public.inventory_items(
    id, name, category, unit, unit_kind, base_unit, unit_factor, stock_base, low_stock_base,
    active, note, created_at, updated_at, created_by, created_by_name
  ) values (
    p_id, v_name, trim(coalesce(p_category,'')), v_unit, v_kind, v_base_unit, v_factor,
    v_initial * v_factor, v_low, true, coalesce(p_note,''), v_now, v_now,
    coalesce(v_profile.id::text, (select auth.uid())::text), coalesce(v_profile.name, '')
  ) returning * into v_item;

  if v_initial <> 0 then
    insert into public.inventory_movements(
      id, inventory_item_id, item_name, movement_type, quantity_base, display_quantity, display_unit,
      stock_before_base, stock_after_base, reason, occurred_at, actor_id, actor_name, dedupe_key
    ) values (
      gen_random_uuid()::text, v_item.id, v_item.name, 'initial_stock', v_initial * v_factor, v_initial, v_unit,
      0, v_initial * v_factor, 'Existencia inicial', v_now,
      coalesce(v_profile.id::text, (select auth.uid())::text), coalesce(v_profile.name,''), 'initial:' || v_item.id
    );
  end if;
  return to_jsonb(v_item);
end;
$$;
revoke all on function public.inventory_create_item(text,text,text,text,numeric,numeric,text) from public, anon;
grant execute on function public.inventory_create_item(text,text,text,text,numeric,numeric,text) to authenticated;

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
  if v_initial <> trunc(v_initial) then
    raise exception 'Los productos de catálogo se cuentan en unidades enteras: usa 1, 2, 3…' using errcode = '22023';
  end if;
  if p_low_stock_quantity is not null and p_low_stock_quantity <> trunc(p_low_stock_quantity) then
    raise exception 'El nivel de alerta del producto debe ser un número entero.' using errcode = '22023';
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
revoke all on function public.inventory_link_catalog_product(text,numeric,numeric) from public, anon;
grant execute on function public.inventory_link_catalog_product(text,numeric,numeric) to authenticated;

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
  v_raw_quantity numeric := coalesce(p_quantity, 0);
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
  if v_item.unit_kind = 'custom' and v_raw_quantity <> trunc(v_raw_quantity) then
    raise exception 'Esta unidad se cuenta en números enteros: usa 1, 2, 3…' using errcode = '22023';
  end if;

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

commit;
