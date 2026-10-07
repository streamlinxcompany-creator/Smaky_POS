-- Permanent sales purge guard.
-- Once StreamLinx deletes a sale, an old offline outbox entry must NEVER be able
-- to recreate it in public.sales. Supabase is the final source of truth.

create table if not exists public.sales_purge_state (
  id boolean primary key default true check (id = true),
  global_before timestamptz
);

create table if not exists public.sales_purge_tombstones (
  sale_id text primary key,
  purged_at timestamptz not null default now()
);

alter table public.sales_purge_state enable row level security;
alter table public.sales_purge_tombstones enable row level security;
revoke all on table public.sales_purge_state from public, anon, authenticated;
revoke all on table public.sales_purge_tombstones from public, anon, authenticated;

-- Seed the permanent guard from the marker used by migrations 0006-0010.
do $$
declare
  marker_value jsonb := null;
  marker_global_before timestamptz := null;
  existing_global_before timestamptz := null;
  marker_sale_ids text[] := array[]::text[];
begin
  select data->'value'
    into marker_value
  from public.settings
  where id = '__smaky_sales_purge_marker'
  limit 1;

  if jsonb_typeof(marker_value) = 'object' then
    begin
      marker_global_before := nullif(marker_value->>'globalBefore', '')::timestamptz;
    exception when others then
      marker_global_before := null;
    end;

    select coalesce(array_agg(value), array[]::text[])
      into marker_sale_ids
    from jsonb_array_elements_text(coalesce(marker_value->'saleIds', '[]'::jsonb));
  elsif jsonb_typeof(marker_value) = 'string' then
    begin
      marker_global_before := nullif(trim(both '"' from marker_value::text), '')::timestamptz;
    exception when others then
      marker_global_before := null;
    end;
  end if;

  select global_before into existing_global_before
  from public.sales_purge_state
  where id = true;

  insert into public.sales_purge_state(id, global_before)
  values (true, marker_global_before)
  on conflict (id) do update
    set global_before = case
      when public.sales_purge_state.global_before is null then excluded.global_before
      when excluded.global_before is null then public.sales_purge_state.global_before
      else greatest(public.sales_purge_state.global_before, excluded.global_before)
    end;

  if coalesce(array_length(marker_sale_ids, 1), 0) > 0 then
    insert into public.sales_purge_tombstones(sale_id, purged_at)
    select distinct value, now()
    from unnest(marker_sale_ids) as value
    where nullif(trim(value), '') is not null
    on conflict (sale_id) do nothing;
  end if;
end;
$$;

create or replace function public.prevent_purged_sales_reinsert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz;
begin
  if exists (
    select 1
    from public.sales_purge_tombstones t
    where t.sale_id = new.id
  ) then
    raise exception 'Venta eliminada definitivamente: %', new.id using errcode = '45001';
  end if;

  select global_before
    into cutoff
  from public.sales_purge_state
  where id = true;

  if cutoff is not null and new.created_at <= cutoff then
    raise exception 'Venta eliminada definitivamente por una purga global: %', new.id using errcode = '45001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_purged_sales_reinsert on public.sales;
create trigger trg_prevent_purged_sales_reinsert
before insert on public.sales
for each row execute function public.prevent_purged_sales_reinsert();

-- Clean any resurrection that happened before this guard was installed.
do $$
declare
  cutoff timestamptz;
  bad_ids text[] := array[]::text[];
begin
  select global_before into cutoff
  from public.sales_purge_state
  where id = true;

  select coalesce(array_agg(s.id), array[]::text[])
    into bad_ids
  from public.sales s
  where exists (select 1 from public.sales_purge_tombstones t where t.sale_id = s.id)
     or (cutoff is not null and s.created_at <= cutoff);

  if coalesce(array_length(bad_ids, 1), 0) = 0 then
    return;
  end if;

  delete from public.history_records
  where entity = 'sale' and record_id = any(bad_ids);

  delete from public.audit_events
  where record_type = 'sale' and record_id = any(bad_ids);

  update public.backup_snapshots b
  set payload = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(b.payload, '{}'::jsonb), '{sales}',
          coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.payload->'sales','[]'::jsonb)) item where not ((item->>'id') = any(bad_ids))), '[]'::jsonb), true),
        '{history}',
          coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.payload->'history','[]'::jsonb)) item where not (item->>'entity'='sale' and (item->>'recordId') = any(bad_ids))), '[]'::jsonb), true),
      '{events}',
        coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.payload->'events','[]'::jsonb)) item where not (item->>'recordType'='sale' and (item->>'recordId') = any(bad_ids))), '[]'::jsonb), true),
    '{closures}',
      coalesce((select jsonb_agg(case when jsonb_typeof(item->'sales')='array' then jsonb_set(item,'{sales}',coalesce((select jsonb_agg(si) from jsonb_array_elements(item->'sales') si where not ((si->>'id') = any(bad_ids))), '[]'::jsonb),true) else item end) from jsonb_array_elements(coalesce(b.payload->'closures','[]'::jsonb)) item), '[]'::jsonb), true);

  update public.cash_closures c
  set data = jsonb_set(coalesce(c.data,'{}'::jsonb), '{sales}',
    coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(c.data->'sales','[]'::jsonb)) item where not ((item->>'id') = any(bad_ids))), '[]'::jsonb), true)
  where coalesce(c.data,'{}'::jsonb) ? 'sales';

  delete from public.sales where id = any(bad_ids);
end;
$$;

-- Replace the StreamLinx RPC so every purge permanently registers its guard.
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
  existing_marker jsonb := '{}'::jsonb;
  existing_sale_ids text[] := array[]::text[];
  existing_global_before timestamptz := null;
  marker_global_before timestamptz := null;
  marker_sale_ids text[] := array[]::text[];
begin
  if p_access_key is distinct from 'e25f201f9014599e00073db598a2603a9c05766965336d9b9c68c3d4081ee9a3' then
    raise exception 'Acceso StreamLinx no autorizado.' using errcode = '42501';
  end if;

  select coalesce(data->'value', '{}'::jsonb)
    into existing_marker
  from public.settings
  where id = '__smaky_sales_purge_marker'
  limit 1;

  begin
    if jsonb_typeof(existing_marker) = 'object' then
      existing_global_before := nullif(existing_marker->>'globalBefore', '')::timestamptz;
      select coalesce(array_agg(value), array[]::text[])
        into existing_sale_ids
      from jsonb_array_elements_text(coalesce(existing_marker->'saleIds', '[]'::jsonb));
    elsif jsonb_typeof(existing_marker) = 'string' then
      existing_global_before := nullif(trim(both '"' from existing_marker::text), '')::timestamptz;
    end if;
  exception when others then
    existing_global_before := null;
  end;

  select global_before into existing_global_before
  from public.sales_purge_state
  where id = true;

  if not is_targeted then
    select coalesce(array_agg(id), array[]::text[])
      into sale_ids
    from public.sales
    where created_at <= p_purge_before;
    marker_global_before := greatest(coalesce(existing_global_before, p_purge_before), p_purge_before);
    marker_sale_ids := coalesce(existing_sale_ids, array[]::text[]);
  else
    marker_global_before := existing_global_before;
    select coalesce(array_agg(distinct id), array[]::text[])
      into marker_sale_ids
    from unnest(coalesce(existing_sale_ids, array[]::text[]) || sale_ids) as id;
  end if;

  -- Write the permanent guard BEFORE deleting the rows. The whole RPC is one
  -- transaction, so a failure rolls back both the guard and the deletion.
  if coalesce(array_length(sale_ids, 1), 0) > 0 then
    insert into public.sales_purge_tombstones(sale_id, purged_at)
    select distinct id, now() from unnest(sale_ids) id
    where nullif(trim(id), '') is not null
    on conflict (sale_id) do nothing;
  end if;

  insert into public.sales_purge_state(id, global_before)
  values (true, marker_global_before)
  on conflict (id) do update
    set global_before = case
      when public.sales_purge_state.global_before is null then excluded.global_before
      when excluded.global_before is null then public.sales_purge_state.global_before
      else greatest(public.sales_purge_state.global_before, excluded.global_before)
    end;

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
            jsonb_set(coalesce(b.payload, '{}'::jsonb), '{sales}',
              coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.payload->'sales','[]'::jsonb)) item where not ((item->>'id') = any(sale_ids))), '[]'::jsonb), true),
            '{history}',
              coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.payload->'history','[]'::jsonb)) item where not (item->>'entity'='sale' and (item->>'recordId') = any(sale_ids))), '[]'::jsonb), true),
          '{events}',
            coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(b.payload->'events','[]'::jsonb)) item where not (item->>'recordType'='sale' and (item->>'recordId') = any(sale_ids))), '[]'::jsonb), true),
        '{closures}',
          coalesce((select jsonb_agg(case when jsonb_typeof(item->'sales')='array' then jsonb_set(item,'{sales}',coalesce((select jsonb_agg(si) from jsonb_array_elements(item->'sales') si where not ((si->>'id') = any(sale_ids))), '[]'::jsonb),true) else item end) from jsonb_array_elements(coalesce(b.payload->'closures','[]'::jsonb)) item), '[]'::jsonb), true),
      contents = jsonb_set(
        jsonb_set(
          jsonb_set(coalesce(b.contents, '{}'::jsonb), '{sales}', to_jsonb((select count(*) from jsonb_array_elements(coalesce(b.payload->'sales','[]'::jsonb)) item where not ((item->>'id') = any(sale_ids)))), true),
          '{history}', to_jsonb((select count(*) from jsonb_array_elements(coalesce(b.payload->'history','[]'::jsonb)) item where not (item->>'entity'='sale' and (item->>'recordId') = any(sale_ids)))), true),
        '{audit}', to_jsonb((select count(*) from jsonb_array_elements(coalesce(b.payload->'events','[]'::jsonb)) item where not (item->>'recordType'='sale' and (item->>'recordId') = any(sale_ids)))), true)
  where coalesce(array_length(sale_ids,1),0) > 0
    and (coalesce(b.payload,'{}'::jsonb) ? 'sales' or coalesce(b.payload,'{}'::jsonb) ? 'history' or coalesce(b.payload,'{}'::jsonb) ? 'events' or coalesce(b.payload,'{}'::jsonb) ? 'closures');
  get diagnostics scrubbed_backups = row_count;

  update public.cash_closures c
  set data = jsonb_set(coalesce(c.data,'{}'::jsonb), '{sales}', coalesce((select jsonb_agg(item) from jsonb_array_elements(coalesce(c.data->'sales','[]'::jsonb)) item where not ((item->>'id') = any(sale_ids))), '[]'::jsonb), true)
  where coalesce(c.data,'{}'::jsonb) ? 'sales';
  get diagnostics scrubbed_closures = row_count;

  if is_targeted then
    select count(*) into remaining_sales from public.sales where id = any(sale_ids);
  else
    select count(*) into remaining_sales from public.sales where created_at <= p_purge_before;
  end if;
  if remaining_sales > 0 then
    raise exception 'La purga no quedó completa: aún existen % ventas.', remaining_sales using errcode = 'P0001';
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
