-- Enable low-latency cross-device updates for POS data.
-- This is idempotent: it adds only existing tables that are not already in the
-- Supabase-managed realtime publication. Offline polling remains as a fallback.
do $$
declare
  target_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publication supabase_realtime not found; polling fallback remains enabled.';
    return;
  end if;

  foreach target_table in array array[
    'settings',
    'products',
    'customers',
    'orders',
    'sales',
    'cash_closures',
    'audit_events',
    'history_records',
    'backup_snapshots'
  ] loop
    if to_regclass(format('public.%I', target_table)) is not null
       and not exists (
         select 1
         from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = target_table
       ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end;
$$;
