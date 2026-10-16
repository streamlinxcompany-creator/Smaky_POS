-- Protect the kitchen ticket number across devices. The browser reserves a
-- number atomically in IndexedDB; this migration is the final server-side
-- guard for devices that create orders at exactly the same time or while one
-- of them was offline.

-- Preserve every historical order. If old data contains duplicate ticket
-- numbers, only the later duplicate is renumbered after the current maximum.
-- Its invoice reference is updated by order_id as well.
-- Some older remote installations do not have created_at in orders, so the
-- fallback for their legacy rows is a fixed technical date rather than a
-- timestamp column that may not exist.
create temporary table _smaky_order_number_repairs on commit drop as
with ranked as (
  select
    id,
    coalesce(business_date_key, date '1970-01-01') as business_day,
    order_number,
    row_number() over (
      partition by coalesce(business_date_key, date '1970-01-01'), order_number
      order by id
    ) as duplicate_position,
    max(order_number) over (
      partition by coalesce(business_date_key, date '1970-01-01')
    ) as day_maximum
  from public.orders
), repaired as (
  select
    id,
    day_maximum + row_number() over (partition by business_day order by id) as new_order_number
  from ranked
  where duplicate_position > 1
)
select * from repaired;

update public.orders as orders
set order_number = repairs.new_order_number,
    data = jsonb_set(coalesce(orders.data, '{}'::jsonb), '{orderNumber}', to_jsonb(repairs.new_order_number), true)
from _smaky_order_number_repairs as repairs
where orders.id = repairs.id;

update public.sales as sales
set order_number = orders.order_number,
    data = jsonb_set(coalesce(sales.data, '{}'::jsonb), '{orderNumber}', to_jsonb(orders.order_number), true)
from public.orders as orders
where sales.order_id = orders.id
  and exists (select 1 from _smaky_order_number_repairs repairs where repairs.id = orders.id);

create unique index if not exists idx_orders_business_day_ticket_unique
on public.orders ((coalesce(business_date_key, date '1970-01-01')), order_number);

create or replace function public.assign_unique_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_day date := coalesce(new.business_date_key, date '1970-01-01');
  next_number integer;
begin
  -- Serialize just this business day. Different days continue independently.
  perform pg_advisory_xact_lock(hashtext(effective_day::text));

  if exists (
    select 1
    from public.orders
    where coalesce(business_date_key, date '1970-01-01') = effective_day
      and order_number = new.order_number
  ) then
    select coalesce(max(order_number), 0) + 1
    into next_number
    from public.orders
    where coalesce(business_date_key, date '1970-01-01') = effective_day;
    new.order_number := next_number;
    new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{orderNumber}', to_jsonb(next_number), true);
  end if;

  return new;
end;
$$;

revoke execute on function public.assign_unique_order_number() from public, anon, authenticated;
drop trigger if exists orders_assign_unique_number on public.orders;
create trigger orders_assign_unique_number
before insert on public.orders
for each row execute function public.assign_unique_order_number();

-- A sale can be completed while its order was still waiting in an offline
-- outbox. Always derive the invoice reference from the final order number.
create or replace function public.align_sale_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  final_number integer;
begin
  if new.order_id is null then
    return new;
  end if;
  select order_number into final_number from public.orders where id = new.order_id;
  if final_number is not null then
    new.order_number := final_number;
    new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{orderNumber}', to_jsonb(final_number), true);
  end if;
  return new;
end;
$$;

revoke execute on function public.align_sale_order_number() from public, anon, authenticated;
drop trigger if exists sales_align_order_number on public.sales;
create trigger sales_align_order_number
before insert or update of order_id, order_number on public.sales
for each row execute function public.align_sale_order_number();
