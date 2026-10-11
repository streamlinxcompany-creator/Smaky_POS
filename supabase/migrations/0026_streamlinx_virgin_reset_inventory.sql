-- StreamLinx factory reset now includes all inventory-owned data.
-- Preserve the sellable catalog in public.products; clear inventory stock records,
-- ingredients, linked-product stock, recipes, combo components, and movements.
-- Reset custom inventory measurement units to the only default: unidad.
-- Existing RPC signature/defaults are intentionally preserved to avoid overloads.

create or replace function public.streamlinx_reset_pos_to_virgin(
  p_reset_at timestamptz default now(),
  p_access_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reset_value timestamptz := coalesce(p_reset_at, now());
  manager_id uuid;
  sales_count integer := 0;
  orders_count integer := 0;
  closures_count integer := 0;
  customers_count integer := 0;
  users_count integer := 0;
  audits_count integer := 0;
  history_count integer := 0;
  backups_count integer := 0;
  inventory_items_count integer := 0;
  inventory_recipes_count integer := 0;
  inventory_product_components_count integer := 0;
  inventory_movements_count integer := 0;
begin
  if p_access_key is distinct from '7391'
     and p_access_key is distinct from 'e25f201f9014599e00073db598a2603a9c05766965336d9b9c68c3d4081ee3' then
    raise exception 'Acceso StreamLinx no autorizado.' using errcode = '42501';
  end if;

  select id into manager_id
  from public.profiles
  where role = 'manager' and active = true
  order by created_at asc
  limit 1;

  if manager_id is null then
    raise exception 'No existe un perfil Gerente activo que pueda conservarse.' using errcode = 'P0001';
  end if;

  -- Server-side marker prevents stale offline outbox records from reappearing.
  insert into public.streamlinx_pos_reset_state(id, reset_at)
  values (true, reset_value)
  on conflict (id) do update set reset_at = excluded.reset_at;

  delete from public.sales where true;
  get diagnostics sales_count = row_count;

  delete from public.orders where true;
  get diagnostics orders_count = row_count;

  delete from public.cash_closures where true;
  get diagnostics closures_count = row_count;

  delete from public.customers where true;
  get diagnostics customers_count = row_count;

  delete from public.history_records where true;
  get diagnostics history_count = row_count;

  delete from public.audit_events where true;
  get diagnostics audits_count = row_count;

  delete from public.backup_snapshots where true;
  get diagnostics backups_count = row_count;

  -- Purge the inventory module, but do NOT delete the catalog products themselves.
  delete from public.inventory_recipe_products where true;
  get diagnostics inventory_product_components_count = row_count;

  delete from public.inventory_recipes where true;
  get diagnostics inventory_recipes_count = row_count;

  delete from public.inventory_movements where true;
  get diagnostics inventory_movements_count = row_count;

  delete from public.inventory_items where true;
  get diagnostics inventory_items_count = row_count;

  -- Ensure late-arriving old sales cannot consume stock after the reset.
  update public.inventory_control
    set ledger_started_at = reset_value
    where id = 'global';

  -- Custom measurement units belong to inventory setup; reset them to defaults.
  -- Preserve all other settings and the normal catalog.
  update public.settings
    set data = jsonb_set(
        jsonb_set(coalesce(data, '{}'::jsonb), '{value}', '[]'::jsonb, true),
        '{updatedAt}', to_jsonb(reset_value::text), true
      ),
      updated_at = reset_value
    where id = 'inventoryUnits';

  -- Retain only the active manager account.
  delete from auth.users where id <> manager_id;
  get diagnostics users_count = row_count;
  delete from public.profiles where id <> manager_id;

  if to_regclass('public.sales_purge_state') is not null then
    delete from public.sales_purge_state where true;
    insert into public.sales_purge_state(id, global_before)
    values (true, reset_value)
    on conflict (id) do update set global_before = excluded.global_before;
  end if;
  if to_regclass('public.sales_purge_tombstones') is not null then
    delete from public.sales_purge_tombstones where true;
  end if;
  if to_regclass('public.cash_closure_purge_state') is not null then
    delete from public.cash_closure_purge_state where true;
    insert into public.cash_closure_purge_state(id, global_before)
    values (true, reset_value)
    on conflict (id) do update set global_before = excluded.global_before;
  end if;
  if to_regclass('public.cash_closure_purge_tombstones') is not null then
    delete from public.cash_closure_purge_tombstones where true;
  end if;

  return jsonb_build_object(
    'resetAt', reset_value,
    'sales', sales_count,
    'orders', orders_count,
    'closures', closures_count,
    'customers', customers_count,
    'users', users_count,
    'audit', audits_count,
    'history', history_count,
    'backups', backups_count,
    'inventoryItems', inventory_items_count,
    'inventoryRecipes', inventory_recipes_count,
    'inventoryProductComponents', inventory_product_components_count,
    'inventoryMovements', inventory_movements_count,
    'managerKept', manager_id
  );
end;
$$;

revoke execute on function public.streamlinx_reset_pos_to_virgin(timestamptz, text) from public;
grant execute on function public.streamlinx_reset_pos_to_virgin(timestamptz, text) to anon, authenticated;

notify pgrst, 'reload schema';
