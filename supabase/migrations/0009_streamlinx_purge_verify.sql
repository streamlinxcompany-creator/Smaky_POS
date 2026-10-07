-- StreamLinx purge hardening: verify the server has no matching sales left.
-- This migration is safe to apply after 0008; it replaces the same RPC signature.

create or replace function public.streamlinx_purge_sales_data(
  p_purge_before timestamptz,
  p_sale_ids text[] default null,
  p_access_key text default null
)
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
  remaining_sales integer := 0;
  sale_ids text[] := coalesce(p_sale_ids, array[]::text[]);
  is_targeted boolean := coalesce(array_length(sale_ids, 1), 0) > 0;
  marker_global_before timestamptz;
  marker_sale_ids text[] := array[]::text[];
  existing_marker jsonb := '{}'::jsonb;
  existing_sale_ids text[] := array[]::text[];
begin
  if p_access_key is distinct from 'e25f201f9014599e00073db598a2603a9c05766965336d9b9c68c3d4081ee9a3' then
    raise exception 'Acceso StreamLinx no autorizado.' using errcode = '42501';
  end if;

  select coalesce(data->'value', '{}'::jsonb)
    into existing_marker
  from public.settings
  where id = '__smaky_sales_purge_marker'
  limit 1;

  select coalesce(array_agg(value), array[]::text[])
    into existing_sale_ids
  from jsonb_array_elements_text(coalesce(existing_marker->'saleIds', '[]'::jsonb));

  if not is_targeted then
    select coalesce(array_agg(id), array[]::text[])
      into sale_ids
    from public.sales
    where created_at <= p_purge_before;
    marker_global_before := p_purge_before;
    marker_sale_ids := array[]::text[];
  else
    begin
      marker_global_before := nullif(existing_marker->>'globalBefore', '')::timestamptz;
    exception when others then
      marker_global_before := null;
    end;
    select coalesce(array_agg(distinct id), array[]::text[])
      into marker_sale_ids
    from unnest(existing_sale_ids || sale_ids) as id;
  end if;

  delete from public.sales where id = any(sale_ids);
  get diagnostics removed_sales = row_count;

  delete from public.history_records where entity = 'sale' and record_id = any(sale_ids);
  get diagnostics removed_history = row_count;

  delete from public.audit_events where record_type = 'sale' and record_id = any(sale_ids);
  get diagnostics removed_audit = row_count;

  update public.backup_snapshots b
  set payload = jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              coalesce(b.payload, '{}'::jsonb), '{sales}',
              coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.payload->'sales', '[]'::jsonb)) item where not ((item->>'id') = any(sale_ids))), '[]'::jsonb), true
            ), '{history}',
            coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.payload->'history', '[]'::jsonb)) item where not (item->>'entity' = 'sale' and (item->>'recordId') = any(sale_ids))), '[]'::jsonb), true
          ), '{events}',
          coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.payload->'events', '[]'::jsonb)) item where not (item->>'recordType' = 'sale' and (item->>'recordId') = any(sale_ids))), '[]'::jsonb), true
        ), '{closures}',
        coalesce((select jsonb_agg(case when jsonb_typeof(item->'sales') = 'array' then jsonb_set(item, '{sales}', coalesce((select jsonb_agg(sale_item) from jsonb_array_elements(item->'sales') sale_item where not ((sale_item->>'id') = any(sale_ids))), '[]'::jsonb), true) else item end) from jsonb_array_elements(coalesce(b.payload->'closures', '[]'::jsonb)) item), '[]'::jsonb), true
      ),
      contents = jsonb_set(
        jsonb_set(
          jsonb_set(coalesce(b.contents, '{}'::jsonb), '{sales}', to_jsonb((select count(*) from jsonb_array_elements(coalesce(b.payload->'sales', '[]'::jsonb)) item where not ((item->>'id') = any(sale_ids)))), true),
          '{history}', to_jsonb((select count(*) from jsonb_array_elements(coalesce(b.payload->'history', '[]'::jsonb)) item where not (item->>'entity' = 'sale' and (item->>'recordId') = any(sale_ids)))), true
        ), '{audit}', to_jsonb((select count(*) from jsonb_array_elements(coalesce(b.payload->'events', '[]'::jsonb)) item where not (item->>'recordType' = 'sale' and (item->>'recordId') = any(sale_ids)))), true
      )
  where coalesce(array_length(sale_ids, 1), 0) > 0;
  get diagnostics scrubbed_backups = row_count;

  update public.cash_closures c
  set data = jsonb_set(coalesce(c.data, '{}'::jsonb), '{sales}', coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(c.data->'sales', '[]'::jsonb)) item where not ((item->>'id') = any(sale_ids))), '[]'::jsonb), true)
  where coalesce(c.data, '{}'::jsonb) ? 'sales';
  get diagnostics scrubbed_closures = row_count;

  if is_targeted then
    select count(*) into remaining_sales
    from public.sales
    where id = any(sale_ids);
  else
    select count(*) into remaining_sales
    from public.sales
    where created_at <= p_purge_before;
  end if;

  insert into public.settings (id, key, updated_at, data)
  values (
    '__smaky_sales_purge_marker', '__smaky_sales_purge_marker', now(),
    jsonb_build_object('value', jsonb_build_object(
      'globalBefore', case when marker_global_before is null then null else marker_global_before::text end,
      'saleIds', to_jsonb(coalesce(marker_sale_ids, array[]::text[]))
    ))
  )
  on conflict (id) do update set updated_at = excluded.updated_at, data = excluded.data;

  return jsonb_build_object(
    'sales', removed_sales,
    'history', removed_history,
    'audit', removed_audit,
    'backups', scrubbed_backups,
    'closures', scrubbed_closures,
    'remainingSales', remaining_sales,
    'purgeBefore', p_purge_before,
    'saleIds', to_jsonb(coalesce(marker_sale_ids, array[]::text[])),
    'globalBefore', case when marker_global_before is null then null else marker_global_before end
  );
end;
$$;

revoke execute on function public.streamlinx_purge_sales_data(timestamptz, text[], text) from public;
grant execute on function public.streamlinx_purge_sales_data(timestamptz, text[], text) to anon, authenticated;
