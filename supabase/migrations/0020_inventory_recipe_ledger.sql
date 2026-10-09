-- Smaky POS inventory: configurable stock, product recipes, atomic movement ledger,
-- and automatic stock consumption when a sale reaches Supabase.
begin;

create table if not exists public.inventory_items (
  id text primary key,
  name text not null check (length(trim(name)) > 0),
  category text not null default '',
  unit text not null check (length(trim(unit)) > 0),
  unit_kind text not null check (unit_kind in ('mass','volume','custom')),
  base_unit text not null,
  unit_factor numeric(18,6) not null check (unit_factor > 0),
  stock_base numeric(18,6) not null default 0,
  low_stock_base numeric(18,6),
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  created_by_name text not null default ''
);

create table if not exists public.inventory_recipes (
  id text primary key,
  product_id text not null,
  product_name text not null,
  inventory_item_id text not null references public.inventory_items(id) on delete restrict,
  item_name text not null,
  quantity_base numeric(18,6) not null check (quantity_base > 0),
  quantity_display numeric(18,6) not null check (quantity_display > 0),
  quantity_unit text not null,
  quantity_factor numeric(18,6) not null check (quantity_factor > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  unique(product_id, inventory_item_id)
);

create table if not exists public.inventory_recipe_products (
  id text primary key,
  product_id text not null,
  product_name text not null,
  component_product_id text not null,
  component_product_name text not null,
  quantity numeric(18,6) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  unique(product_id, component_product_id),
  check (product_id <> component_product_id)
);

create table if not exists public.inventory_movements (
  id text primary key,
  inventory_item_id text not null references public.inventory_items(id) on delete restrict,
  item_name text not null,
  movement_type text not null check (movement_type in ('initial_stock','entry','exit','sale_consumption','sale_reversal')),
  quantity_base numeric(18,6) not null,
  display_quantity numeric(18,6) not null,
  display_unit text not null,
  stock_before_base numeric(18,6) not null,
  stock_after_base numeric(18,6) not null,
  reason text not null default '',
  occurred_at timestamptz not null default now(),
  actor_id text,
  actor_name text not null default '',
  sale_id text,
  sale_order_number integer,
  sale_total numeric(14,2),
  sale_payment text,
  sale_snapshot jsonb,
  product_id text,
  product_name text,
  sold_product_quantity numeric(18,6),
  sale_line_index integer,
  dedupe_key text unique,
  reversal_of text unique,
  created_at timestamptz not null default now()
);

-- Capture the moment when inventory tracking becomes active. Old sales that
-- arrive late from a device's pre-inventory outbox must not consume today's stock.
create table if not exists public.inventory_control (
  id text primary key check (id = 'global'),
  ledger_started_at timestamptz not null default now()
);
insert into public.inventory_control(id, ledger_started_at)
values ('global', now())
on conflict (id) do nothing;
alter table public.inventory_control enable row level security;
revoke all on table public.inventory_control from anon, authenticated;

create index if not exists idx_inventory_items_active_name on public.inventory_items(active, name);
create index if not exists idx_inventory_recipes_product on public.inventory_recipes(product_id);
create index if not exists idx_inventory_recipes_item on public.inventory_recipes(inventory_item_id);
create index if not exists idx_inventory_recipe_products_parent on public.inventory_recipe_products(product_id);
create index if not exists idx_inventory_recipe_products_component on public.inventory_recipe_products(component_product_id);
create index if not exists idx_inventory_movements_item_date on public.inventory_movements(inventory_item_id, occurred_at desc);
create index if not exists idx_inventory_movements_sale on public.inventory_movements(sale_id, occurred_at desc);
create index if not exists idx_inventory_movements_type_date on public.inventory_movements(movement_type, occurred_at desc);

alter table public.inventory_items enable row level security;
alter table public.inventory_recipes enable row level security;
alter table public.inventory_recipe_products enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists inventory_items_select on public.inventory_items;
drop policy if exists inventory_items_insert on public.inventory_items;
drop policy if exists inventory_items_update on public.inventory_items;
drop policy if exists inventory_recipes_select on public.inventory_recipes;
drop policy if exists inventory_recipe_products_select on public.inventory_recipe_products;
drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_items_select on public.inventory_items for select to authenticated
  using ((select private.is_active_user()) and (select private.has_permission('inventory.manage')));
create policy inventory_recipes_select on public.inventory_recipes for select to authenticated
  using ((select private.is_active_user()) and (select private.has_permission('inventory.manage')));
create policy inventory_recipe_products_select on public.inventory_recipe_products for select to authenticated
  using ((select private.is_active_user()) and (select private.has_permission('inventory.manage')));
create policy inventory_movements_select on public.inventory_movements for select to authenticated
  using ((select private.is_active_user()) and (select private.has_permission('inventory.manage')));

revoke all on table public.inventory_items, public.inventory_recipes, public.inventory_recipe_products, public.inventory_movements from anon;
revoke all on table public.inventory_items, public.inventory_recipes, public.inventory_recipe_products, public.inventory_movements from authenticated;
grant select on table public.inventory_items, public.inventory_recipes, public.inventory_recipe_products, public.inventory_movements to authenticated;

drop trigger if exists inventory_items_touch_updated_at on public.inventory_items;
create trigger inventory_items_touch_updated_at before update on public.inventory_items
  for each row execute function public.touch_updated_at();
drop trigger if exists inventory_recipe_products_touch_updated_at on public.inventory_recipe_products;
create trigger inventory_recipe_products_touch_updated_at before update on public.inventory_recipe_products
  for each row execute function public.touch_updated_at();

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

create or replace function public.inventory_update_item(
  p_item_id text,
  p_name text,
  p_category text,
  p_low_stock_quantity numeric,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_items%rowtype;
  v_name text := trim(coalesce(p_name, ''));
  v_low numeric(18,6);
begin
  if not coalesce((select private.is_active_user()), false)
     or not coalesce((select private.has_permission('inventory.manage')), false) then
    raise exception 'No tienes permiso para administrar inventario.' using errcode = '42501';
  end if;
  if coalesce(trim(p_item_id), '') = '' or v_name = '' then
    raise exception 'El ingrediente necesita un nombre.' using errcode = '22023';
  end if;
  if p_low_stock_quantity is not null then
    if p_low_stock_quantity < 0 then raise exception 'El mínimo de existencias no puede ser negativo.' using errcode = '22023'; end if;
    select * into v_item from public.inventory_items where id = p_item_id for update;
    if not found then raise exception 'Ingrediente no encontrado.' using errcode = 'P0002'; end if;
    v_low := p_low_stock_quantity * v_item.unit_factor;
  else
    select * into v_item from public.inventory_items where id = p_item_id for update;
    if not found then raise exception 'Ingrediente no encontrado.' using errcode = 'P0002'; end if;
    v_low := null;
  end if;
  update public.inventory_items set
    name = v_name,
    category = trim(coalesce(p_category, '')),
    low_stock_base = v_low,
    note = coalesce(p_note, ''),
    updated_at = now()
  where id = p_item_id returning * into v_item;
  return to_jsonb(v_item);
end;
$$;

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
  v_delta numeric(18,6);
  v_before numeric(18,6);
  v_after numeric(18,6);
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
  if coalesce(p_quantity,0) <= 0 then raise exception 'La cantidad debe ser mayor que cero.' using errcode = '22023'; end if;
  if v_kind not in ('entry','exit') then raise exception 'Tipo de movimiento no válido.' using errcode = '22023'; end if;
  if v_reason = '' then raise exception 'Indica el motivo del movimiento.' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtext('inventory-movement:' || p_movement_id));
  select * into v_existing from public.inventory_movements where id = p_movement_id;
  if found then return to_jsonb(v_existing); end if;

  select * into v_item from public.inventory_items where id = p_item_id and active = true for update;
  if not found then raise exception 'El ingrediente no existe o está archivado.' using errcode = 'P0002'; end if;
  v_delta := p_quantity * v_item.unit_factor * case when v_kind = 'entry' then 1 else -1 end;
  v_before := v_item.stock_base;
  v_after := v_before + v_delta;
  update public.inventory_items set stock_base = v_after, updated_at = now() where id = v_item.id;
  select * into v_profile from public.profiles where id = (select auth.uid()) and active = true;
  insert into public.inventory_movements(
    id, inventory_item_id, item_name, movement_type, quantity_base, display_quantity, display_unit,
    stock_before_base, stock_after_base, reason, occurred_at, actor_id, actor_name, dedupe_key
  ) values (
    p_movement_id, v_item.id, v_item.name, v_kind, v_delta, v_delta / v_item.unit_factor, v_item.unit,
    v_before, v_after, v_reason, v_at,
    coalesce(v_profile.id::text, (select auth.uid())::text), coalesce(v_profile.name,''), 'manual:' || p_movement_id
  ) returning * into v_existing;
  return to_jsonb(v_existing);
end;
$$;

create or replace function public.inventory_save_product_recipe(
  p_product_id text,
  p_product_name text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_row jsonb;
  v_item public.inventory_items%rowtype;
  v_item_id text;
  v_qty numeric(18,6);
  v_unit text;
  v_factor numeric(18,6);
  v_saved integer := 0;
  v_total integer := 0;
begin
  if not coalesce((select private.is_active_user()), false)
     or not coalesce((select private.has_permission('inventory.manage')), false) then
    raise exception 'No tienes permiso para administrar recetas.' using errcode = '42501';
  end if;
  if coalesce(trim(p_product_id),'') = '' or coalesce(trim(p_product_name),'') = '' then
    raise exception 'Selecciona un producto válido.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'La lista de ingredientes no tiene un formato válido.' using errcode = '22023';
  end if;
  select count(*) into v_total from jsonb_array_elements(p_rows);
  if v_total <> (select count(distinct x->>'inventory_item_id') from jsonb_array_elements(p_rows) as t(x)) then
    raise exception 'No repitas el mismo ingrediente en una receta.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('inventory-recipe:' || p_product_id));
  select * into v_profile from public.profiles where id = (select auth.uid()) and active = true;
  delete from public.inventory_recipes where product_id = p_product_id;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_item_id := trim(coalesce(v_row->>'inventory_item_id',''));
    v_qty := nullif(v_row->>'quantity','')::numeric;
    v_unit := trim(coalesce(v_row->>'unit',''));
    if v_item_id = '' or v_qty is null or v_qty <= 0 then
      raise exception 'Cada ingrediente requiere una cantidad mayor que cero.' using errcode = '22023';
    end if;
    select * into v_item from public.inventory_items where id = v_item_id and active = true;
    if not found then raise exception 'Uno de los ingredientes ya no está disponible.' using errcode = '22023'; end if;
    if v_unit = '' then v_unit := v_item.unit; end if;
    if v_item.unit_kind = 'mass' then
      if lower(v_unit) in ('g','gramo','gramos') then v_factor := 1;
      elsif lower(v_unit) in ('kg','kilogramo','kilogramos') then v_factor := 1000;
      else raise exception 'Para % elige gramos o kilogramos.', v_item.name using errcode = '22023'; end if;
    elsif v_item.unit_kind = 'volume' then
      if lower(v_unit) in ('ml','mililitro','mililitros') then v_factor := 1;
      elsif lower(v_unit) in ('l','litro','litros') then v_factor := 1000;
      else raise exception 'Para % elige mililitros o litros.', v_item.name using errcode = '22023'; end if;
    else
      if lower(v_unit) <> lower(v_item.unit) then
        raise exception 'El ingrediente % debe consumirse en su unidad configurada: %.', v_item.name, v_item.unit using errcode = '22023';
      end if;
      v_factor := v_item.unit_factor;
    end if;
    insert into public.inventory_recipes(
      id, product_id, product_name, inventory_item_id, item_name,
      quantity_base, quantity_display, quantity_unit, quantity_factor,
      created_at, updated_at, created_by
    ) values (
      gen_random_uuid()::text, p_product_id, trim(p_product_name), v_item.id, v_item.name,
      v_qty * v_factor, v_qty, v_unit, v_factor,
      now(), now(), coalesce(v_profile.id::text, (select auth.uid())::text)
    );
    v_saved := v_saved + 1;
  end loop;
  return jsonb_build_object('product_id',p_product_id,'ingredients_saved',v_saved,'updated_at',now());
end;
$$;

create or replace function public.inventory_save_product_recipe_v2(
  p_product_id text,
  p_product_name text,
  p_rows jsonb,
  p_product_components jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_row jsonb;
  v_item public.inventory_items%rowtype;
  v_item_id text;
  v_qty numeric(18,6);
  v_unit text;
  v_factor numeric(18,6);
  v_component_id text;
  v_component_qty numeric(18,6);
  v_component_name text;
  v_parent_name text;
  v_cycle boolean;
  v_ingredients_saved integer := 0;
  v_components_saved integer := 0;
  v_total integer := 0;
begin
  if not coalesce((select private.is_active_user()), false)
     or not coalesce((select private.has_permission('inventory.manage')), false) then
    raise exception 'No tienes permiso para administrar recetas.' using errcode = '42501';
  end if;
  if coalesce(trim(p_product_id),'') = '' or coalesce(trim(p_product_name),'') = '' then
    raise exception 'Selecciona un producto válido.' using errcode = '22023';
  end if;
  select p.name into v_parent_name
  from public.products p
  where p.id = trim(p_product_id) and p.active = true and p.deleted_at is null;
  if not found then
    raise exception 'El producto ya no existe o está archivado en el catálogo.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'La lista de ingredientes no tiene un formato válido.' using errcode = '22023';
  end if;
  if p_product_components is null then p_product_components := '[]'::jsonb; end if;
  if jsonb_typeof(p_product_components) <> 'array' then
    raise exception 'La lista de productos incluidos no tiene un formato válido.' using errcode = '22023';
  end if;

  select count(*) into v_total from jsonb_array_elements(p_rows);
  if v_total <> (select count(distinct x->>'inventory_item_id') from jsonb_array_elements(p_rows) as t(x)) then
    raise exception 'No repitas el mismo ingrediente en una receta.' using errcode = '22023';
  end if;
  select count(*) into v_total from jsonb_array_elements(p_product_components);
  if v_total <> (select count(distinct x->>'component_product_id') from jsonb_array_elements(p_product_components) as t(x)) then
    raise exception 'No repitas el mismo producto incluido; cambia su cantidad en una sola línea.' using errcode = '22023';
  end if;

  -- Serialize recipe graph edits so two devices cannot create a cycle concurrently.
  perform pg_advisory_xact_lock(hashtext('inventory-recipe-graph'));
  perform pg_advisory_xact_lock(hashtext('inventory-recipe:' || trim(p_product_id)));

  -- Validate component existence and reject cycles before replacing any saved rows.
  for v_row in select value from jsonb_array_elements(p_product_components) loop
    v_component_id := trim(coalesce(v_row->>'component_product_id',''));
    v_component_qty := nullif(v_row->>'quantity','')::numeric;
    if v_component_id = '' or v_component_qty is null or v_component_qty <= 0 then
      raise exception 'Cada producto incluido requiere una cantidad mayor que cero.' using errcode = '22023';
    end if;
    if v_component_id = trim(p_product_id) then
      raise exception 'Un producto no puede incluirse a sí mismo.' using errcode = '22023';
    end if;
    select p.name into v_component_name
    from public.products p
    where p.id = v_component_id and p.active = true and p.deleted_at is null;
    if not found then
      raise exception 'Uno de los productos incluidos ya no existe o está archivado.' using errcode = '22023';
    end if;
    with recursive component_walk(node_id, path) as (
      select v_component_id, array[v_component_id]::text[]
      union all
      select edge.component_product_id, walk.path || edge.component_product_id
      from component_walk walk
      join public.inventory_recipe_products edge on edge.product_id = walk.node_id
      where walk.node_id <> trim(p_product_id)
        and not (edge.component_product_id = any(walk.path))
    )
    select exists(select 1 from component_walk where node_id = trim(p_product_id)) into v_cycle;
    if coalesce(v_cycle,false) then
      raise exception 'Esta combinación crearía un ciclo de recetas. Retira ese producto incluido.' using errcode = '22023';
    end if;
  end loop;

  select * into v_profile from public.profiles where id = (select auth.uid()) and active = true;
  delete from public.inventory_recipes where product_id = trim(p_product_id);
  delete from public.inventory_recipe_products where product_id = trim(p_product_id);

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_item_id := trim(coalesce(v_row->>'inventory_item_id',''));
    v_qty := nullif(v_row->>'quantity','')::numeric;
    v_unit := trim(coalesce(v_row->>'unit',''));
    if v_item_id = '' or v_qty is null or v_qty <= 0 then
      raise exception 'Cada ingrediente requiere una cantidad mayor que cero.' using errcode = '22023';
    end if;
    select * into v_item from public.inventory_items where id = v_item_id and active = true;
    if not found then raise exception 'Uno de los ingredientes ya no está disponible.' using errcode = '22023'; end if;
    if v_unit = '' then v_unit := v_item.unit; end if;
    if v_item.unit_kind = 'mass' then
      if lower(v_unit) in ('g','gramo','gramos') then v_factor := 1;
      elsif lower(v_unit) in ('kg','kilogramo','kilogramos') then v_factor := 1000;
      else raise exception 'Para % elige gramos o kilogramos.', v_item.name using errcode = '22023'; end if;
    elsif v_item.unit_kind = 'volume' then
      if lower(v_unit) in ('ml','mililitro','mililitros') then v_factor := 1;
      elsif lower(v_unit) in ('l','litro','litros') then v_factor := 1000;
      else raise exception 'Para % elige mililitros o litros.', v_item.name using errcode = '22023'; end if;
    else
      if lower(v_unit) <> lower(v_item.unit) then
        raise exception 'El ingrediente % debe consumirse en su unidad configurada: %.', v_item.name, v_item.unit using errcode = '22023';
      end if;
      v_factor := v_item.unit_factor;
    end if;
    insert into public.inventory_recipes(
      id, product_id, product_name, inventory_item_id, item_name,
      quantity_base, quantity_display, quantity_unit, quantity_factor,
      created_at, updated_at, created_by
    ) values (
      gen_random_uuid()::text, trim(p_product_id), trim(p_product_name), v_item.id, v_item.name,
      v_qty * v_factor, v_qty, v_unit, v_factor,
      now(), now(), coalesce(v_profile.id::text, (select auth.uid())::text)
    );
    v_ingredients_saved := v_ingredients_saved + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(p_product_components) loop
    v_component_id := trim(coalesce(v_row->>'component_product_id',''));
    v_component_qty := nullif(v_row->>'quantity','')::numeric;
    select p.name into v_component_name from public.products p
      where p.id = v_component_id and p.active = true and p.deleted_at is null;
    insert into public.inventory_recipe_products(
      id, product_id, product_name, component_product_id, component_product_name,
      quantity, created_at, updated_at, created_by
    ) values (
      gen_random_uuid()::text, trim(p_product_id), trim(p_product_name), v_component_id, coalesce(v_component_name, v_component_id),
      v_component_qty, now(), now(), coalesce(v_profile.id::text, (select auth.uid())::text)
    );
    v_components_saved := v_components_saved + 1;
  end loop;

  return jsonb_build_object(
    'product_id', trim(p_product_id),
    'ingredients_saved', v_ingredients_saved,
    'components_saved', v_components_saved,
    'updated_at', now()
  );
end;
$$;

create or replace function public.inventory_set_item_active(p_item_id text, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_item public.inventory_items%rowtype;
begin
  if not coalesce((select private.is_active_user()), false)
     or not coalesce((select private.has_permission('inventory.manage')), false) then
    raise exception 'No tienes permiso para administrar inventario.' using errcode = '42501';
  end if;
  select * into v_item from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Ingrediente no encontrado.' using errcode = 'P0002'; end if;
  if not coalesce(p_active,false) and exists(select 1 from public.inventory_recipes where inventory_item_id = p_item_id) then
    raise exception 'Este ingrediente aparece en recetas. Retíralo de esas recetas antes de archivarlo.' using errcode = '23503';
  end if;
  update public.inventory_items set active = coalesce(p_active,false), updated_at = now() where id = p_item_id returning * into v_item;
  return to_jsonb(v_item);
end;
$$;

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
      coalesce(line.item->>'productId', line.item->>'product_id') as product_id,
      greatest(coalesce(nullif(line.item->>'quantity', '')::numeric, 0), 0) as quantity
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_items, '[]'::jsonb)) = 'array'
        then coalesce(p_items, '[]'::jsonb) else '[]'::jsonb end
    ) as line(item)
  ), product_tree(root_product_id, current_product_id, multiplier, path) as (
    select sale_lines.product_id, sale_lines.product_id, sale_lines.quantity::numeric(18,6), array[sale_lines.product_id]::text[]
    from sale_lines where sale_lines.product_id is not null and sale_lines.quantity > 0
    union all
    select tree.root_product_id, component.component_product_id,
      (tree.multiplier * component.quantity)::numeric(18,6), tree.path || component.component_product_id
    from product_tree tree
    join public.inventory_recipe_products component on component.product_id = tree.current_product_id
    where not (component.component_product_id = any(tree.path))
  ), required as (
    select recipe.inventory_item_id,
      sum(tree.multiplier * recipe.quantity_base)::numeric(18,6) as required_base
    from product_tree tree
    join public.inventory_recipes recipe on recipe.product_id = tree.current_product_id
    group by recipe.inventory_item_id
  )
  select
    item.id,
    item.name,
    item.unit,
    round(item.stock_base / item.unit_factor, 6),
    round(required.required_base / item.unit_factor, 6),
    round((required.required_base - item.stock_base) / item.unit_factor, 6)
  from required
  join public.inventory_items item on item.id = required.inventory_item_id and item.active = true
  where item.stock_base < required.required_base
  order by item.name;
end;
$$;

create or replace function public.inventory_apply_sale_consumption(
  p_sale_id text,
  p_sale_created_at timestamptz,
  p_sale_updated_at timestamptz,
  p_sale_data jsonb,
  p_sale_order_number integer,
  p_sale_total numeric,
  p_sale_payment text
)
returns void
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
  v_cycle text := coalesce(p_sale_updated_at, p_sale_created_at, now())::text;
begin
  if coalesce(p_sale_id,'') = '' or coalesce(p_sale_data->>'deletedAt','') <> '' then return; end if;
  for v_line in
    with recursive sale_lines as (
      select
        si.ordinality::integer as line_no,
        coalesce(si.item->>'productId', si.item->>'product_id') as product_id,
        coalesce(si.item->>'name','Producto') as product_name,
        greatest(coalesce(nullif(si.item->>'quantity','')::numeric,0),0) as sold_quantity
      from jsonb_array_elements(
        case when jsonb_typeof(coalesce(p_sale_data->'items','[]'::jsonb)) = 'array'
          then coalesce(p_sale_data->'items','[]'::jsonb) else '[]'::jsonb end
      ) with ordinality as si(item, ordinality)
    ), product_tree(line_no, root_product_id, root_product_name, sold_quantity, current_product_id, multiplier, path) as (
      select line.line_no, line.product_id, line.product_name, line.sold_quantity,
        line.product_id, 1::numeric(18,6), array[line.product_id]::text[]
      from sale_lines line
      where line.product_id is not null and line.sold_quantity > 0
      union all
      select tree.line_no, tree.root_product_id, tree.root_product_name, tree.sold_quantity,
        component.component_product_id, (tree.multiplier * component.quantity)::numeric(18,6), tree.path || component.component_product_id
      from product_tree tree
      join public.inventory_recipe_products component on component.product_id = tree.current_product_id
      where not (component.component_product_id = any(tree.path))
    ), required as (
      select tree.line_no, tree.root_product_id as product_id, tree.root_product_name as product_name,
        tree.sold_quantity, recipe.inventory_item_id,
        sum(tree.multiplier * recipe.quantity_base)::numeric(18,6) as quantity_base
      from product_tree tree
      join public.inventory_recipes recipe on recipe.product_id = tree.current_product_id
      group by tree.line_no, tree.root_product_id, tree.root_product_name, tree.sold_quantity, recipe.inventory_item_id
    )
    select required.line_no, required.product_id, required.product_name, required.sold_quantity,
      required.inventory_item_id, required.quantity_base, item.name as item_name, item.unit, item.unit_factor
    from required
    join public.inventory_items item on item.id = required.inventory_item_id and item.active = true
    order by required.line_no, required.inventory_item_id
  loop
    v_need := round(v_line.quantity_base * v_line.sold_quantity, 6);
    if v_need <= 0 then continue; end if;
    v_dedupe := 'sale:' || p_sale_id || ':cycle:' || v_cycle || ':line:' || v_line.line_no::text || ':item:' || v_line.inventory_item_id;
    if exists(select 1 from public.inventory_movements where dedupe_key = v_dedupe) then continue; end if;
    update public.inventory_items set stock_base = stock_base - v_need, updated_at = now()
      where id = v_line.inventory_item_id returning stock_base into v_after;
    if not found then continue; end if;
    v_before := v_after + v_need;
    insert into public.inventory_movements(
      id, inventory_item_id, item_name, movement_type, quantity_base, display_quantity, display_unit,
      stock_before_base, stock_after_base, reason, occurred_at, actor_id, actor_name,
      sale_id, sale_order_number, sale_total, sale_payment, sale_snapshot,
      product_id, product_name, sold_product_quantity, sale_line_index, dedupe_key
    ) values (
      gen_random_uuid()::text, v_line.inventory_item_id, v_line.item_name, 'sale_consumption', -v_need,
      -v_need / v_line.unit_factor, v_line.unit, v_before, v_after, 'Consumo automático por venta',
      coalesce(p_sale_created_at,now()), p_sale_data->>'userId', coalesce(p_sale_data->>'userName',''),
      p_sale_id, p_sale_order_number, p_sale_total, p_sale_payment, p_sale_data,
      v_line.product_id, v_line.product_name, v_line.sold_quantity, v_line.line_no, v_dedupe
    );
  end loop;
end;
$$;

create or replace function public.inventory_reverse_sale_consumption(p_sale_id text)
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
    select m.* from public.inventory_movements m
    where m.sale_id = p_sale_id and m.movement_type = 'sale_consumption'
      and not exists (select 1 from public.inventory_movements rev where rev.reversal_of = m.id)
    order by m.inventory_item_id, m.id
  loop
    update public.inventory_items set stock_base = stock_base - v_move.quantity_base, updated_at = now()
      where id = v_move.inventory_item_id returning stock_base into v_after;
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
      v_move.actor_id, v_move.actor_name, v_move.sale_id, v_move.sale_order_number, v_move.sale_total, v_move.sale_payment,
      v_move.sale_snapshot, v_move.product_id, v_move.product_name, v_move.sold_product_quantity, v_move.sale_line_index,
      'reversal:' || v_move.id, v_move.id
    );
  end loop;
end;
$$;

create or replace function public.inventory_sales_insert_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is null
     and new.created_at >= coalesce((select c.ledger_started_at from public.inventory_control c where c.id = 'global'), now()) then
    perform public.inventory_apply_sale_consumption(new.id, new.created_at, new.updated_at, coalesce(new.data,'{}'::jsonb), new.order_number, new.total, new.payment);
  end if;
  return new;
end;
$$;

create or replace function public.inventory_sales_deleted_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    perform public.inventory_reverse_sale_consumption(new.id);
  elsif old.deleted_at is not null and new.deleted_at is null
        and new.created_at >= coalesce((select c.ledger_started_at from public.inventory_control c where c.id = 'global'), now()) then
    perform public.inventory_apply_sale_consumption(new.id, new.created_at, new.updated_at, coalesce(new.data,'{}'::jsonb), new.order_number, new.total, new.payment);
  end if;
  return new;
end;
$$;

revoke all on function public.inventory_create_item(text,text,text,text,numeric,numeric,text) from public, anon;
revoke all on function public.inventory_update_item(text,text,text,numeric,text) from public, anon;
revoke all on function public.inventory_apply_movement(text,text,numeric,text,text,timestamptz) from public, anon;
revoke all on function public.inventory_save_product_recipe(text,text,jsonb) from public, anon;
revoke all on function public.inventory_save_product_recipe_v2(text,text,jsonb,jsonb) from public, anon;
revoke all on function public.inventory_set_item_active(text,boolean) from public, anon;
revoke all on function public.inventory_check_sale_shortages(jsonb) from public, anon;
revoke all on function public.inventory_apply_sale_consumption(text,timestamptz,timestamptz,jsonb,integer,numeric,text) from public, anon, authenticated;
revoke all on function public.inventory_reverse_sale_consumption(text) from public, anon, authenticated;
revoke all on function public.inventory_sales_insert_trigger() from public, anon, authenticated;
revoke all on function public.inventory_sales_deleted_trigger() from public, anon, authenticated;
grant execute on function public.inventory_create_item(text,text,text,text,numeric,numeric,text) to authenticated;
grant execute on function public.inventory_update_item(text,text,text,numeric,text) to authenticated;
grant execute on function public.inventory_apply_movement(text,text,numeric,text,text,timestamptz) to authenticated;
grant execute on function public.inventory_save_product_recipe(text,text,jsonb) to authenticated;
grant execute on function public.inventory_save_product_recipe_v2(text,text,jsonb,jsonb) to authenticated;
grant execute on function public.inventory_set_item_active(text,boolean) to authenticated;
grant execute on function public.inventory_check_sale_shortages(jsonb) to authenticated;

drop trigger if exists sales_inventory_consume_after_insert on public.sales;
drop trigger if exists sales_inventory_reverse_after_delete on public.sales;
create trigger sales_inventory_consume_after_insert after insert on public.sales
  for each row execute function public.inventory_sales_insert_trigger();
create trigger sales_inventory_reverse_after_delete after update of deleted_at on public.sales
  for each row execute function public.inventory_sales_deleted_trigger();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='inventory_items') then
      alter publication supabase_realtime add table public.inventory_items;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='inventory_recipes') then
      alter publication supabase_realtime add table public.inventory_recipes;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='inventory_recipe_products') then
      alter publication supabase_realtime add table public.inventory_recipe_products;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='inventory_movements') then
      alter publication supabase_realtime add table public.inventory_movements;
    end if;
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
