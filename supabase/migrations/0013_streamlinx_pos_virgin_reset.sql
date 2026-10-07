-- StreamLinx global factory reset.
-- Keeps only the manager profile, products, settings and the StreamLinx access itself.
-- Deletes all operational/business history and blocks stale offline writes from
-- recreating pre-reset records on any device.

create table if not exists public.streamlinx_pos_reset_state (
  id boolean primary key default true check (id = true),
  reset_at timestamptz not null
);

alter table public.streamlinx_pos_reset_state enable row level security;
revoke all on table public.streamlinx_pos_reset_state from public, anon, authenticated;

create or replace function public.streamlinx_get_pos_reset_state(
  p_access_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reset_value timestamptz;
begin
  if p_access_key is distinct from 'e25f201f9014599e00073db598a2603a9c05766965336d9b9c68c3d4081ee9a3' then
    raise exception 'Acceso StreamLinx no autorizado.' using errcode = '42501';
  end if;

  select reset_at into reset_value
  from public.streamlinx_pos_reset_state
  where id = true;

  return jsonb_build_object('resetAt', reset_value);
end;
$$;

revoke execute on function public.streamlinx_get_pos_reset_state(text) from public;
grant execute on function public.streamlinx_get_pos_reset_state(text) to anon, authenticated;

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
  if p_access_key is distinct from 'e25f201f9014599e00073db598a2603a9c05766965336d9b9c68c3d4081ee9a3' then
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

  -- Register the reset timestamp BEFORE deleting anything. This is the server-side
  -- source of truth used by every client to discard stale offline outbox entries.
  insert into public.streamlinx_pos_reset_state(id, reset_at)
  values (true, reset_value)
  on conflict (id) do update set reset_at = excluded.reset_at;

  -- Physically remove all transactional/business records.
  delete from public.sales;
  get diagnostics sales_count = row_count;

  delete from public.orders;
  get diagnostics orders_count = row_count;

  delete from public.cash_closures;
  get diagnostics closures_count = row_count;

  delete from public.customers;
  get diagnostics customers_count = row_count;

  delete from public.history_records;
  get diagnostics history_count = row_count;

  delete from public.audit_events;
  get diagnostics audits_count = row_count;

  delete from public.backup_snapshots;
  get diagnostics backups_count = row_count;

  -- Keep exactly the manager in the application profile table. Deleting auth.users
  -- cascades its profile row when the corresponding user is not the manager.
  delete from auth.users where id <> manager_id;
  get diagnostics users_count = row_count;

  delete from public.profiles where id <> manager_id;

  -- Reset the earlier sale/cash purge state so the next fresh POS session starts
  -- clean while the new global-reset timestamp remains the stale-write boundary.
  if to_regclass('public.sales_purge_state') is not null then
    delete from public.sales_purge_state;
    insert into public.sales_purge_state(id, global_before) values (true, reset_value);
  end if;
  if to_regclass('public.sales_purge_tombstones') is not null then
    delete from public.sales_purge_tombstones;
  end if;
  if to_regclass('public.cash_closure_purge_state') is not null then
    delete from public.cash_closure_purge_state;
    insert into public.cash_closure_purge_state(id, global_before) values (true, reset_value);
  end if;
  if to_regclass('public.cash_closure_purge_tombstones') is not null then
    delete from public.cash_closure_purge_tombstones;
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

-- Server-side guard against stale offline writes for resettable entities.
create or replace function public.prevent_stale_streamlinx_reset_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reset_value timestamptz;
  candidate_time timestamptz;
begin
  select reset_at into reset_value
  from public.streamlinx_pos_reset_state
  where id = true;

  if reset_value is null then
    return new;
  end if;

  candidate_time := case tg_table_name
    when 'cash_closures' then new.closed_at
    else new.created_at
  end;

  if candidate_time is not null and candidate_time <= reset_value then
    raise exception 'Registro anterior al último reinicio global del POS: %', new.id using errcode = '45003';
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_stale_streamlinx_reset_write() from public, anon, authenticated;

drop trigger if exists trg_sales_streamlinx_reset_guard on public.sales;
create trigger trg_sales_streamlinx_reset_guard
before insert or update on public.sales
for each row execute function public.prevent_stale_streamlinx_reset_write();

drop trigger if exists trg_orders_streamlinx_reset_guard on public.orders;
create trigger trg_orders_streamlinx_reset_guard
before insert or update on public.orders
for each row execute function public.prevent_stale_streamlinx_reset_write();

drop trigger if exists trg_customers_streamlinx_reset_guard on public.customers;
create trigger trg_customers_streamlinx_reset_guard
before insert or update on public.customers
for each row execute function public.prevent_stale_streamlinx_reset_write();

drop trigger if exists trg_cash_closures_streamlinx_reset_guard on public.cash_closures;
create trigger trg_cash_closures_streamlinx_reset_guard
before insert or update on public.cash_closures
for each row execute function public.prevent_stale_streamlinx_reset_write();
