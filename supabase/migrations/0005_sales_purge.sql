-- Permanent sales purge used only by the privileged StreamLinx Command Center.
-- Unlike reset_test_data(), this removes sales instead of creating tombstones.
-- It also clears sale-specific audit/history and strips sales snapshots from
-- existing backups/closed-cash snapshots so the old invoice data cannot be
-- reintroduced by the offline IndexedDB cache.

create or replace function public.purge_sales_data(p_purge_before timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_sales integer := 0;
  removed_history integer := 0;
  removed_audit integer := 0;
  scrubbed_backups integer := 0;
  scrubbed_closures integer := 0;
  sale_ids text[] := '{}'::text[];
begin
  if not coalesce((select private.is_manager()), false) then
    raise exception 'Solo el gerente puede purgar las ventas definitivamente.' using errcode = '42501';
  end if;

  select coalesce(array_agg(id), '{}'::text[])
    into sale_ids
  from public.sales
  where created_at <= p_purge_before;

  delete from public.sales
  where id = any(sale_ids);
  get diagnostics removed_sales = row_count;

  delete from public.history_records
  where entity = 'sale'
    and (record_id = any(sale_ids) or captured_at <= p_purge_before);
  get diagnostics removed_history = row_count;

  delete from public.audit_events
  where record_type = 'sale'
    and (record_id = any(sale_ids) or timestamp <= p_purge_before);
  get diagnostics removed_audit = row_count;

  -- Existing backup snapshots keep their structure but no longer contain a
  -- sales array. This avoids retaining a second copy of the invoices.
  update public.backup_snapshots
  set payload = coalesce(payload, '{}'::jsonb) - 'sales',
      contents = jsonb_set(coalesce(contents, '{}'::jsonb), '{sales}', '0'::jsonb, true)
  where coalesce(payload, '{}'::jsonb) ? 'sales';
  get diagnostics scrubbed_backups = row_count;

  -- Cash closures may contain a complete Sale[] snapshot for the closing report.
  -- Only closures that existed by the requested purge cutoff are scrubbed.
  update public.cash_closures
  set data = jsonb_set(coalesce(data, '{}'::jsonb), '{sales}', '[]'::jsonb, true)
  where closed_at <= p_purge_before
    and coalesce(data, '{}'::jsonb) ? 'sales';
  get diagnostics scrubbed_closures = row_count;

  -- Replicated marker. Every browser pulls this before flushing its outbox, so
  -- stale IndexedDB sales are deleted locally instead of being uploaded again.
  insert into public.settings (id, key, updated_at, data)
  values (
    '__smaky_sales_purge_marker',
    '__smaky_sales_purge_marker',
    now(),
    jsonb_build_object('value', p_purge_before::text)
  )
  on conflict (id) do update
  set updated_at = excluded.updated_at,
      data = excluded.data;

  return jsonb_build_object(
    'sales', removed_sales,
    'history', removed_history,
    'audit', removed_audit,
    'backups', scrubbed_backups,
    'closures', scrubbed_closures,
    'purgeBefore', p_purge_before
  );
end;
$$;

revoke execute on function public.purge_sales_data(timestamptz) from public, anon;
grant execute on function public.purge_sales_data(timestamptz) to authenticated;
