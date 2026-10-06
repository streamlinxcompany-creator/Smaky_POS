-- Offline-first synchronization support.
-- Supabase remains the authoritative store; the browser IndexedDB database is
-- only a durable cache + outbox for disconnected operation.

create table if not exists public.backup_snapshots (
  id text primary key,
  created_at timestamptz not null,
  created_by text not null,
  kind text not null check (kind in ('manual', 'pre-destructive', 'pre-restore')),
  label text not null,
  size integer not null default 0,
  contents jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_backup_snapshots_created_at on public.backup_snapshots(created_at desc);

alter table public.backup_snapshots enable row level security;

drop policy if exists backups_select on public.backup_snapshots;
drop policy if exists backups_insert on public.backup_snapshots;
create policy backups_select on public.backup_snapshots
for select to authenticated
using ((select private.is_manager_or_admin()));
create policy backups_insert on public.backup_snapshots
for insert to authenticated
with check ((select private.is_manager_or_admin()) and (select private.is_active_user()));

revoke all on table public.backup_snapshots from anon;
revoke all on table public.backup_snapshots from authenticated;
grant select, insert on table public.backup_snapshots to authenticated;

create or replace function public.reset_test_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id text := (select auth.uid())::text;
  now_ts timestamptz := now();
  sales_count integer := 0;
  orders_count integer := 0;
  closures_count integer := 0;
begin
  if not coalesce((select private.is_manager()), false) then
    raise exception 'Solo el gerente puede restablecer los datos de prueba.' using errcode = '42501';
  end if;

  update public.sales
  set deleted_at = now_ts,
      deleted_by = actor_id
  where deleted_at is null;
  get diagnostics sales_count = row_count;

  update public.orders
  set deleted_at = now_ts,
      deleted_by = actor_id
  where deleted_at is null;
  get diagnostics orders_count = row_count;

  update public.cash_closures
  set deleted_at = now_ts,
      deleted_by = actor_id
  where deleted_at is null;
  get diagnostics closures_count = row_count;

  return jsonb_build_object(
    'sales', sales_count,
    'orders', orders_count,
    'closures', closures_count,
    'deletedAt', now_ts
  );
end;
$$;

revoke execute on function public.reset_test_data() from public, anon;
grant execute on function public.reset_test_data() to authenticated;
