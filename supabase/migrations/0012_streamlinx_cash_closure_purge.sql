-- StreamLinx: permanent cash-closure purge.
-- A closure removed from StreamLinx is physically deleted from Supabase, scrubbed
-- from server-side history/audit/backups, and blocked from being recreated by any
-- stale offline outbox on another device.

create table if not exists public.cash_closure_purge_state (
  id boolean primary key default true check (id = true),
  global_before timestamptz
);

create table if not exists public.cash_closure_purge_tombstones (
  closure_id text primary key,
  purged_at timestamptz not null default now()
);

alter table public.cash_closure_purge_state enable row level security;
alter table public.cash_closure_purge_tombstones enable row level security;
revoke all on table public.cash_closure_purge_state from public, anon, authenticated;
revoke all on table public.cash_closure_purge_tombstones from public, anon, authenticated;

create or replace function public.prevent_purged_cash_closure_reinsert()
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
    from public.cash_closure_purge_tombstones t
    where t.closure_id = new.id
  ) then
    raise exception 'Cierre eliminado definitivamente: %', new.id using errcode = '45002';
  end if;

  select global_before
    into cutoff
  from public.cash_closure_purge_state
  where id = true;

  if cutoff is not null and new.closed_at <= cutoff then
    raise exception 'Cierre eliminado definitivamente por una purga global: %', new.id using errcode = '45002';
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_purged_cash_closure_reinsert() from public, anon, authenticated;
drop trigger if exists trg_prevent_purged_cash_closure_reinsert on public.cash_closures;
create trigger trg_prevent_purged_cash_closure_reinsert
before insert or update on public.cash_closures
for each row execute function public.prevent_purged_cash_closure_reinsert();

create or replace function public.streamlinx_purge_cash_closures(
  p_purge_before timestamptz,
  p_closure_ids text[] default null,
  p_access_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  purge_before_ts timestamptz := coalesce(p_purge_before, now());
  targeted boolean := coalesce(array_length(p_closure_ids, 1), 0) > 0;
  requested_ids text[] := coalesce(p_closure_ids, array[]::text[]);
  ids_to_purge text[] := array[]::text[];
  existing_global_before timestamptz := null;
  removed_closures integer := 0;
  removed_history integer := 0;
  removed_audit integer := 0;
  scrubbed_backups integer := 0;
  remaining_closures integer := 0;
begin
  if p_access_key is distinct from 'e25f201f9014599e00073db598a2603a9c05766965336d9b9c68c3d4081ee9a3' then
    raise exception 'Acceso StreamLinx no autorizado.' using errcode = '42501';
  end if;

  select global_before
    into existing_global_before
  from public.cash_closure_purge_state
  where id = true;

  if targeted then
    select coalesce(array_agg(distinct c.id), array[]::text[])
      into ids_to_purge
    from public.cash_closures c
    where c.id = any(requested_ids);
  else
    select coalesce(array_agg(c.id), array[]::text[])
      into ids_to_purge
    from public.cash_closures c
    where c.closed_at <= purge_before_ts;
  end if;

  -- Register the deleted IDs before deleting rows so a stale offline upsert can
  -- never recreate one of them later.
  if coalesce(array_length(ids_to_purge, 1), 0) > 0 then
    insert into public.cash_closure_purge_tombstones(closure_id, purged_at)
    select distinct value, now()
    from unnest(ids_to_purge) as value
    where nullif(trim(value), '') is not null
    on conflict (closure_id) do update set purged_at = excluded.purged_at;
  end if;

  -- A global purge also protects every closure that existed at the cutoff,
  -- even if a stale device later tries to recreate an ID we did not see here.
  if not targeted then
    insert into public.cash_closure_purge_state(id, global_before)
    values (true, purge_before_ts)
    on conflict (id) do update
      set global_before = case
        when public.cash_closure_purge_state.global_before is null then excluded.global_before
        else greatest(public.cash_closure_purge_state.global_before, excluded.global_before)
      end;
  elsif existing_global_before is not null then
    insert into public.cash_closure_purge_state(id, global_before)
    values (true, existing_global_before)
    on conflict (id) do update set global_before = excluded.global_before;
  end if;

  delete from public.history_records
  where entity = 'closure'
    and record_id = any(ids_to_purge);
  get diagnostics removed_history = row_count;

  delete from public.audit_events
  where record_type = 'closure'
    and record_id = any(ids_to_purge);
  get diagnostics removed_audit = row_count;

  -- Remove closure snapshots from every server-side backup without touching the
  -- underlying sales themselves. A closure is only the historical cash-close
  -- report; deleting it must not delete the sales it summarizes.
  update public.backup_snapshots b
  set payload = jsonb_set(
        coalesce(b.payload, '{}'::jsonb),
        '{closures}',
        coalesce((
          select jsonb_agg(item)
          from jsonb_array_elements(coalesce(b.payload->'closures', '[]'::jsonb)) item
          where case
            when targeted then not ((item->>'id') = any(ids_to_purge))
            else (coalesce(nullif(item->>'closedAt', ''), nullif(item->>'updatedAt', ''))::timestamptz > purge_before_ts)
          end
        ), '[]'::jsonb),
        true
      )
  where coalesce(b.payload, '{}'::jsonb) ? 'closures';
  get diagnostics scrubbed_backups = row_count;

  -- Keep backup object counts consistent with the scrubbed payload.
  update public.backup_snapshots b
  set contents = jsonb_set(
    coalesce(b.contents, '{}'::jsonb),
    '{closures}',
    to_jsonb(jsonb_array_length(coalesce(b.payload->'closures', '[]'::jsonb))),
    true
  )
  where coalesce(b.payload, '{}'::jsonb) ? 'closures';

  delete from public.cash_closures
  where id = any(ids_to_purge);
  get diagnostics removed_closures = row_count;

  if targeted then
    select count(*)
      into remaining_closures
    from public.cash_closures
    where id = any(requested_ids);
  else
    select count(*)
      into remaining_closures
    from public.cash_closures
    where closed_at <= purge_before_ts;
  end if;

  return jsonb_build_object(
    'closures', removed_closures,
    'history', removed_history,
    'audit', removed_audit,
    'backups', scrubbed_backups,
    'remainingClosures', remaining_closures,
    'purgeBefore', purge_before_ts,
    'closureIds', to_jsonb(ids_to_purge),
    'targeted', targeted
  );
end;
$$;

revoke execute on function public.streamlinx_purge_cash_closures(timestamptz, text[], text) from public;
grant execute on function public.streamlinx_purge_cash_closures(timestamptz, text[], text) to anon, authenticated;
