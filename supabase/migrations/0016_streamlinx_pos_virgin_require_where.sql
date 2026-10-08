-- Fix StreamLinx POS Virgin reset for projects that enforce a WHERE clause
-- on DELETE statements (Supabase/PostgreSQL environments may reject a bare
-- DELETE with error 21000: "DELETE requires a WHERE clause").
--
-- This replaces the existing canonical function created by migration 0013.
-- No data is changed by this migration itself; the guarded DELETE statements
-- execute only when the StreamLinx reset button is actually called.

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
begin
  if p_access_key is distinct from 'e25f201f9014599e00073db598a2603a9c05766965336d9b9c68c3d4081ee3' then
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

  insert into public.streamlinx_pos_reset_state(id, reset_at)
  values (true, reset_value)
  on conflict (id) do update set reset_at = excluded.reset_at;

  -- Explicit WHERE true keeps this compatible with environments that reject
  -- WHERE-less DELETE statements, while still deleting every row.
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
    'managerKept', manager_id
  );
end;
$$;

revoke execute on function public.streamlinx_reset_pos_to_virgin(timestamptz, text) from public;
grant execute on function public.streamlinx_reset_pos_to_virgin(timestamptz, text) to anon, authenticated;

notify pgrst, 'reload schema';
