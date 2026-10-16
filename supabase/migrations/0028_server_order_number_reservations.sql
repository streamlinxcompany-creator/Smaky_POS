-- A kitchen ticket must be reserved before the browser prints it. A trigger
-- can repair a duplicate after upload, but that is too late for the printer.
create table if not exists public.order_number_counters (
  business_date_key date primary key,
  next_number integer not null check (next_number > 0),
  updated_at timestamptz not null default now()
);

create or replace function public.reserve_order_number(p_business_date_key date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_day date := coalesce(p_business_date_key, current_date);
  first_available integer;
  reserved_number integer;
begin
  if not coalesce((select private.is_active_user()), false) then
    raise exception 'Sesión no autorizada para reservar una comanda.' using errcode = '42501';
  end if;

  -- Serializes reservations for just this operating day. The counter records
  -- a reservation immediately, so a second device cannot receive its number
  -- even if the first browser has not uploaded the full order yet.
  perform pg_advisory_xact_lock(hashtext(effective_day::text));
  select coalesce(max(order_number), 0) + 1
    into first_available
  from public.orders
  where coalesce(business_date_key, date '1970-01-01') = effective_day;

  insert into public.order_number_counters as counter (business_date_key, next_number, updated_at)
  values (effective_day, first_available + 1, now())
  on conflict (business_date_key) do update
    set next_number = greatest(counter.next_number, first_available) + 1,
        updated_at = now()
  returning next_number - 1 into reserved_number;

  return reserved_number;
end;
$$;

revoke all on table public.order_number_counters from public, anon, authenticated;
revoke execute on function public.reserve_order_number(date) from public, anon;
grant execute on function public.reserve_order_number(date) to authenticated;
