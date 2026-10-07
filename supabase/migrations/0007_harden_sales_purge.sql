-- Harden StreamLinx permanent sales purge for already-deployed databases.
-- No manager PIN is requested by the UI. Supabase still enforces that the signed-in
-- account is an active manager/admin so the destructive RPC is not public.

drop function if exists public.purge_sales_data(timestamptz, text[]);

create or replace function public.purge_sales_data(
  p_purge_before timestamptz,
  p_sale_ids text[] default null
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
  sale_ids text[] := coalesce(p_sale_ids, array[]::text[]);
  is_targeted boolean := coalesce(array_length(sale_ids, 1), 0) > 0;
  existing_marker jsonb := '{}'::jsonb;
  existing_global_before timestamptz;
  existing_sale_ids text[] := array[]::text[];
  marker_global_before timestamptz;
  marker_sale_ids text[] := array[]::text[];
begin
  if not coalesce((select private.is_manager_or_admin()), false) then
    raise exception 'La operación requiere una cuenta administrativa activa.' using errcode = '42501';
  end if;

  select coalesce(data->'value', '{}'::jsonb)
    into existing_marker
  from public.settings
  where id = '__smaky_sales_purge_marker'
  limit 1;

  if jsonb_typeof(existing_marker) = 'object' then
    begin
      existing_global_before := nullif(existing_marker->>'globalBefore', '')::timestamptz;
    exception when others then
      existing_global_before := null;
    end;
  end if;

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
    marker_global_before := existing_global_before;
    select coalesce(array_agg(distinct id), array[]::text[])
      into marker_sale_ids
    from unnest(existing_sale_ids || sale_ids) as id;
  end if;

  delete from public.sales
  where id = any(sale_ids);
  get diagnostics removed_sales = row_count;

  delete from public.history_records
  where entity = 'sale' and record_id = any(sale_ids);
  get diagnostics removed_history = row_count;

  delete from public.audit_events
  where record_type = 'sale' and record_id = any(sale_ids);
  get diagnostics removed_audit = row_count;

  -- Scrub every remote backup copy that can still carry the deleted invoice:
  -- top-level sales, sale history, sale audit events and embedded closure sales.
  update public.backup_snapshots b
  set payload =
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                coalesce(b.payload, '{}'::jsonb),
                '{sales}',
                coalesce((
                  select jsonb_agg(item)
                  from jsonb_array_elements(coalesce(b.payload->'sales', '[]'::jsonb)) item
                  where not ((item->>'id') = any(sale_ids))
                ), '[]'::jsonb), true
              ),
              '{history}',
              coalesce((
                select jsonb_agg(item)
                from jsonb_array_elements(coalesce(b.payload->'history', '[]'::jsonb)) item
                where not (item->>'entity' = 'sale' and (item->>'recordId') = any(sale_ids))
              ), '[]'::jsonb), true
            ),
            '{events}',
            coalesce((
              select jsonb_agg(item)
              from jsonb_array_elements(coalesce(b.payload->'events', '[]'::jsonb)) item
              where not (item->>'recordType' = 'sale' and (item->>'recordId') = any(sale_ids))
            ), '[]'::jsonb), true
          ),
          '{closures}',
          coalesce((
            select jsonb_agg(
              case
                when jsonb_typeof(item->'sales') = 'array' then
                  jsonb_set(
                    item,
                    '{sales}',
                    coalesce((
                      select jsonb_agg(sale_item)
                      from jsonb_array_elements(item->'sales') sale_item
                      where not ((sale_item->>'id') = any(sale_ids))
                    ), '[]'::jsonb), true
                  )
                else item
              end
            )
            from jsonb_array_elements(coalesce(b.payload->'closures', '[]'::jsonb)) item
          ), '[]'::jsonb), true
        ),
      contents = jsonb_set(
        jsonb_set(
          jsonb_set(
            coalesce(b.contents, '{}'::jsonb),
            '{sales}',
            to_jsonb((
              select count(*)
              from jsonb_array_elements(coalesce(b.payload->'sales', '[]'::jsonb)) item
              where not ((item->>'id') = any(sale_ids))
            )), true
          ),
          '{history}',
          to_jsonb((
            select count(*)
            from jsonb_array_elements(coalesce(b.payload->'history', '[]'::jsonb)) item
            where not (item->>'entity' = 'sale' and (item->>'recordId') = any(sale_ids))
          )), true
        ),
        '{audit}',
        to_jsonb((
          select count(*)
          from jsonb_array_elements(coalesce(b.payload->'events', '[]'::jsonb)) item
          where not (item->>'recordType' = 'sale' and (item->>'recordId') = any(sale_ids))
        )), true
      )
  where coalesce(array_length(sale_ids, 1), 0) > 0
    and (
      coalesce(b.payload, '{}'::jsonb) ? 'sales'
      or coalesce(b.payload, '{}'::jsonb) ? 'history'
      or coalesce(b.payload, '{}'::jsonb) ? 'events'
      or coalesce(b.payload, '{}'::jsonb) ? 'closures'
    );
  get diagnostics scrubbed_backups = row_count;

  update public.cash_closures c
  set data = jsonb_set(
        coalesce(c.data, '{}'::jsonb),
        '{sales}',
        coalesce((
          select jsonb_agg(item)
          from jsonb_array_elements(coalesce(c.data->'sales', '[]'::jsonb)) item
          where not ((item->>'id') = any(sale_ids))
        ), '[]'::jsonb), true
      )
  where coalesce(c.data, '{}'::jsonb) ? 'sales'
    and (
      is_targeted
      or c.closed_at <= p_purge_before
    );
  get diagnostics scrubbed_closures = row_count;

  insert into public.settings (id, key, updated_at, data)
  values (
    '__smaky_sales_purge_marker',
    '__smaky_sales_purge_marker',
    now(),
    jsonb_build_object(
      'value', jsonb_build_object(
        'globalBefore', case when marker_global_before is null then null else marker_global_before::text end,
        'saleIds', to_jsonb(coalesce(marker_sale_ids, array[]::text[]))
      )
    )
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
    'purgeBefore', p_purge_before,
    'saleIds', to_jsonb(coalesce(marker_sale_ids, array[]::text[])),
    'globalBefore', case when marker_global_before is null then null else marker_global_before end
  );
end;
$$;

revoke execute on function public.purge_sales_data(timestamptz, text[]) from public, anon;
grant execute on function public.purge_sales_data(timestamptz, text[]) to authenticated;
