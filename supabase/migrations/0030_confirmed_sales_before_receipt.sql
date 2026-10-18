-- A printed invoice is an operational commitment.  The POS now waits for the
-- INSERT below to commit, and this migration makes the server transaction the
-- single source of truth for both the sale and the order state.
--
-- It also serializes concurrent attempts for one order.  Two browser tabs (or
-- two devices) cannot turn the same order into two invoices; a retry receives
-- SQLSTATE 23505 and the client recovers the already committed invoice.

create or replace function public.guard_one_active_sale_per_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order_status text;
begin
  if new.order_id is null then
    return new;
  end if;

  -- Lock the order row, which serializes two cashiers attempting to charge it
  -- at exactly the same moment without imposing a global checkout lock.
  select status
    into current_order_status
  from public.orders
  where id = new.order_id
  for update;

  if not found then
    raise exception 'El pedido asociado a la venta no existe.' using errcode = '23503';
  end if;

  if current_order_status = 'cancelled' then
    raise exception 'No se puede cobrar un pedido cancelado.' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.sales
    where order_id = new.order_id
      and deleted_at is null
      -- Let INSERT ... ON CONFLICT (id) DO NOTHING retry the same invoice.
      and id <> new.id
  ) then
    raise exception 'Este pedido ya tiene una factura activa.' using errcode = '23505';
  end if;

  return new;
end;
$$;

create or replace function public.mark_order_paid_from_sale()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_id is not null and new.deleted_at is null then
    update public.orders
    set status = 'paid',
        data = jsonb_set(coalesce(data, '{}'::jsonb), '{status}', to_jsonb('paid'::text), true)
    where id = new.order_id
      and status <> 'paid';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_one_active_sale_per_order() from public, anon, authenticated;
revoke execute on function public.mark_order_paid_from_sale() from public, anon, authenticated;

drop trigger if exists sales_guard_one_active_invoice on public.sales;
create trigger sales_guard_one_active_invoice
before insert on public.sales
for each row execute function public.guard_one_active_sale_per_order();

drop trigger if exists sales_mark_order_paid_after_insert on public.sales;
create trigger sales_mark_order_paid_after_insert
after insert on public.sales
for each row execute function public.mark_order_paid_from_sale();
