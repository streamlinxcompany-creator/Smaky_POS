-- Consecutivo de comandas sin saltos ni duplicados + pedidos cobrados estables.
--
-- Problema corregido:
-- 1. El cliente sincroniza los pedidos con `upsert ... on conflict (id)`. En
--    PostgreSQL ese INSERT dispara los triggers BEFORE INSERT aunque la fila ya
--    exista. assign_unique_order_number() (0027) buscaba el número sin excluir
--    el propio id, se encontraba a sí mismo y renumeraba el pedido a max + 1 en
--    cada actualización (imprimir comanda, editar, cobrar). Resultado: números
--    que "saltan" (#31 -> #33), números repetidos en pantalla y pedidos que
--    cambian de número después de impresos.
-- 2. reserve_order_number() (0028) consumía un número aunque el pedido nunca
--    llegara a guardarse, dejando huecos en la numeración.
--
-- Nuevo diseño:
-- * El número se asigna en el MISMO INSERT que crea el pedido en Supabase
--   (trigger BEFORE INSERT, serializado por día operativo). Si el INSERT falla,
--   la transacción se revierte y el número no se consume: no hay huecos.
-- * Un pedido existente nunca cambia de número (trigger BEFORE UPDATE).
-- * Un pedido pagado o cancelado no puede volver a "pendiente" porque una
--   copia vieja de otro equipo lo sobrescriba.

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
  -- INSERT ... ON CONFLICT (id) DO UPDATE también pasa por aquí. Si la fila ya
  -- existe, el número le pertenece a esa fila y lo protege el trigger de UPDATE.
  if exists (select 1 from public.orders where id = new.id) then
    return new;
  end if;

  -- Serializa solo las altas del mismo día operativo.
  perform pg_advisory_xact_lock(hashtext(effective_day::text));

  -- Clientes antiguos todavía envían un número reservado. Se respeta solo si
  -- está libre; los clientes nuevos envían 0 y reciben el siguiente número.
  if coalesce(new.order_number, 0) > 0 and not exists (
    select 1
    from public.orders
    where coalesce(business_date_key, date '1970-01-01') = effective_day
      and order_number = new.order_number
  ) then
    next_number := new.order_number;
  else
    select coalesce(max(order_number), 0) + 1
      into next_number
    from public.orders
    where coalesce(business_date_key, date '1970-01-01') = effective_day;
  end if;

  new.order_number := next_number;
  new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{orderNumber}', to_jsonb(next_number), true);
  return new;
end;
$$;

revoke execute on function public.assign_unique_order_number() from public, anon, authenticated;
drop trigger if exists orders_assign_unique_number on public.orders;
create trigger orders_assign_unique_number
before insert on public.orders
for each row execute function public.assign_unique_order_number();

create or replace function public.preserve_order_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- El número de comanda ya fue impreso: ninguna copia local puede cambiarlo.
  new.order_number := old.order_number;

  -- Un cobro/cancelación es definitivo. Una copia atrasada de otro equipo (o
  -- una respuesta de red que llegó tarde) no puede devolverlo a "pendiente".
  if old.status in ('paid', 'cancelled') and new.status not in ('paid', 'cancelled') then
    new.status := old.status;
  end if;

  new.data := jsonb_set(
    jsonb_set(coalesce(new.data, '{}'::jsonb), '{orderNumber}', to_jsonb(new.order_number), true),
    '{status}', to_jsonb(new.status), true
  );
  return new;
end;
$$;

revoke execute on function public.preserve_order_identity() from public, anon, authenticated;
drop trigger if exists orders_preserve_identity on public.orders;
create trigger orders_preserve_identity
before update on public.orders
for each row execute function public.preserve_order_identity();

-- Compatibilidad con equipos que aún no actualizan la aplicación: devuelve el
-- siguiente número libre SIN consumirlo, para no dejar huecos. El trigger de
-- INSERT resuelve cualquier choque entre dos equipos antiguos.
create or replace function public.reserve_order_number(p_business_date_key date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_day date := coalesce(p_business_date_key, current_date);
  first_available integer;
begin
  if not coalesce((select private.is_active_user()), false) then
    raise exception 'Sesión no autorizada para reservar una comanda.' using errcode = '42501';
  end if;

  select coalesce(max(order_number), 0) + 1
    into first_available
  from public.orders
  where coalesce(business_date_key, date '1970-01-01') = effective_day;

  return first_available;
end;
$$;

revoke execute on function public.reserve_order_number(date) from public, anon;
grant execute on function public.reserve_order_number(date) to authenticated;
