-- Fix: prevent_stale_streamlinx_reset_write is attached to several tables.
-- A generic trigger RECORD cannot safely reference NEW.closed_at for rows
-- from tables such as orders, sales or customers. Convert NEW to JSON and
-- read the column that belongs to the current table instead.
create or replace function public.prevent_stale_streamlinx_reset_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reset_value timestamptz;
  candidate_time timestamptz;
  row_data jsonb;
begin
  select reset_at into reset_value
  from public.streamlinx_pos_reset_state
  where id = true;

  if reset_value is null then
    return new;
  end if;

  row_data := to_jsonb(new);
  if tg_table_name = 'cash_closures' then
    candidate_time := nullif(row_data ->> 'closed_at', '')::timestamptz;
  else
    candidate_time := nullif(row_data ->> 'created_at', '')::timestamptz;
  end if;

  if candidate_time is not null and candidate_time <= reset_value then
    raise exception 'Registro anterior al último reinicio global del POS: %', row_data ->> 'id'
      using errcode = '45003';
  end if;

  return new;
end;
$$;

revoke execute on function public.prevent_stale_streamlinx_reset_write() from public, anon, authenticated;

notify pgrst, 'reload schema';
