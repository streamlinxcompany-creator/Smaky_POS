create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  legacy_id text unique,
  auth_email text not null unique,
  name text not null,
  role text not null check (role in ('manager', 'admin', 'employee')),
  rank text not null default 'Trabajador',
  active boolean not null default true,
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  name text not null,
  category text not null,
  price numeric(14,2) not null default 0,
  active boolean not null default true,
  deleted_at timestamptz,
  deleted_by text,
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.customers (
  id text primary key,
  name text not null,
  phone text not null,
  address text not null default '',
  notes text not null default '',
  active boolean not null default true,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.orders (
  id text primary key,
  order_number integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  user_id text,
  customer_id text,
  status text not null,
  business_date_key date,
  total numeric(14,2) not null default 0,
  deleted_at timestamptz,
  deleted_by text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.sales (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  user_id text,
  customer_id text,
  payment text not null,
  order_id text,
  order_number integer,
  business_date_key date,
  total numeric(14,2) not null default 0,
  deleted_at timestamptz,
  deleted_by text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.cash_closures (
  id text primary key,
  date_key date not null,
  closed_at timestamptz not null,
  user_id text,
  total numeric(14,2) not null default 0,
  deleted_at timestamptz,
  deleted_by text,
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.settings (
  id text primary key,
  key text not null unique,
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.audit_events (
  id text primary key,
  timestamp timestamptz not null,
  actor_id text,
  actor_name text not null,
  role text,
  module text not null,
  action text not null,
  record_type text not null,
  record_id text,
  before_data jsonb,
  after_data jsonb,
  reason text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.history_records (
  id text primary key,
  entity text not null,
  record_id text not null,
  version integer not null default 1,
  captured_at timestamptz not null,
  event_id text,
  deleted boolean not null default false,
  snapshot jsonb not null default '{}'::jsonb,
  data jsonb not null default '{}'::jsonb
);

create index if not exists idx_products_updated_at on public.products(updated_at);
create index if not exists idx_products_category on public.products(category);
create index if not exists idx_customers_phone on public.customers(phone);
create index if not exists idx_customers_updated_at on public.customers(updated_at);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_orders_business_date on public.orders(business_date_key);
create index if not exists idx_orders_status on public.orders(status);
create index if not exists idx_sales_created_at on public.sales(created_at desc);
create index if not exists idx_sales_business_date on public.sales(business_date_key);
create index if not exists idx_sales_payment on public.sales(payment);
create index if not exists idx_closures_date_key on public.cash_closures(date_key);
create index if not exists idx_settings_key on public.settings(key);
create index if not exists idx_audit_timestamp on public.audit_events(timestamp desc);
create index if not exists idx_audit_actor on public.audit_events(actor_id);
create index if not exists idx_history_entity_record on public.history_records(entity, record_id, version);
create unique index if not exists idx_profiles_one_manager on public.profiles(role) where role = 'manager';

create or replace function private.current_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.active = true limit 1;
$$;

create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.active = true);
$$;

create or replace function private.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select private.current_role()) = 'manager', false);
$$;

create or replace function private.is_manager_or_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select private.current_role()) in ('manager', 'admin'), false);
$$;

create or replace function private.has_permission(permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active = true
      and (p.role = 'manager' or p.permissions ? permission_key)
  );
$$;

revoke execute on function private.current_role() from public, anon;
revoke execute on function private.is_active_user() from public, anon;
revoke execute on function private.is_manager() from public, anon;
revoke execute on function private.is_manager_or_admin() from public, anon;
revoke execute on function private.has_permission(text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_role() to authenticated;
grant execute on function private.is_active_user() to authenticated;
grant execute on function private.is_manager() to authenticated;
grant execute on function private.is_manager_or_admin() to authenticated;
grant execute on function private.has_permission(text) to authenticated;

create or replace function public.touch_updated_at()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

drop trigger if exists profiles_touch_updated_at on public.profiles;
drop trigger if exists products_touch_updated_at on public.products;
drop trigger if exists customers_touch_updated_at on public.customers;
drop trigger if exists orders_touch_updated_at on public.orders;
drop trigger if exists sales_touch_updated_at on public.sales;
drop trigger if exists closures_touch_updated_at on public.cash_closures;
drop trigger if exists settings_touch_updated_at on public.settings;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
create trigger products_touch_updated_at before update on public.products for each row execute function public.touch_updated_at();
create trigger customers_touch_updated_at before update on public.customers for each row execute function public.touch_updated_at();
create trigger orders_touch_updated_at before update on public.orders for each row execute function public.touch_updated_at();
create trigger sales_touch_updated_at before update on public.sales for each row execute function public.touch_updated_at();
create trigger closures_touch_updated_at before update on public.cash_closures for each row execute function public.touch_updated_at();
create trigger settings_touch_updated_at before update on public.settings for each row execute function public.touch_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  app_meta jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  role_value text := coalesce(meta->>'smaky_role', 'employee');
  legacy_value text := nullif(meta->>'smaky_legacy_id', '');
  name_value text := nullif(meta->>'smaky_name', '');
  rank_value text := nullif(meta->>'smaky_rank', '');
  permissions_value jsonb := coalesce(meta->'smaky_permissions', '[]'::jsonb);
  email_value text := lower(coalesce(new.email, ''));
begin
  if email_value like '%@smaky.local'
    and role_value in ('employee', 'admin')
    and app_meta->>'smaky_provisioned' = 'true' then
    insert into public.profiles (id, legacy_id, auth_email, name, role, rank, active, permissions)
    values (new.id, legacy_value, email_value, coalesce(name_value, 'Usuario'), role_value,
      coalesce(rank_value, case when role_value = 'admin' then 'Administrador' else 'Trabajador' end), true, permissions_value)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

-- Vincula el gerente principal aunque la cuenta de Auth ya exista antes de ejecutar este SQL.
insert into public.profiles (id, legacy_id, auth_email, name, role, rank, active, permissions)
select u.id, 'u-owner', lower(u.email), 'Gerente', 'manager', 'Gerente General', true,
  '["dashboard.view","pos.access","customers.manage","customers.export","sales.view","sales.delete","products.manage","reports.view","cashClosing.access"]'::jsonb
from auth.users u
where lower(coalesce(u.email, '')) = 'u-owner@smaky.local'
  and not exists (select 1 from public.profiles where role = 'manager')
on conflict (id) do nothing;

create or replace function public.set_audit_actor()
returns trigger language plpgsql security definer set search_path = '' as $$
declare profile_row public.profiles;
begin
  select * into profile_row from public.profiles where id = (select auth.uid());
  if profile_row.id is not null then
    new.actor_id := profile_row.id::text;
    new.actor_name := profile_row.name;
    new.role := profile_row.role;
  end if;
  return new;
end;
$$;
revoke execute on function public.set_audit_actor() from public, anon, authenticated;
drop trigger if exists audit_actor_guard on public.audit_events;
create trigger audit_actor_guard before insert on public.audit_events for each row execute function public.set_audit_actor();

create or replace function public.guard_order_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
     and not coalesce((select private.is_manager()), false) then
    raise exception 'Solo el gerente puede archivar pedidos.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create or replace function public.guard_closure_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
     and not coalesce((select private.is_manager()), false) then
    raise exception 'Solo el gerente puede archivar cierres.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_order_delete() from public, anon, authenticated;
revoke execute on function public.guard_closure_delete() from public, anon, authenticated;
drop trigger if exists order_delete_guard on public.orders;
drop trigger if exists closure_delete_guard on public.cash_closures;
create trigger order_delete_guard before update on public.orders for each row execute function public.guard_order_delete();
create trigger closure_delete_guard before update on public.cash_closures for each row execute function public.guard_closure_delete();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.sales enable row level security;
alter table public.cash_closures enable row level security;
alter table public.settings enable row level security;
alter table public.audit_events enable row level security;
alter table public.history_records enable row level security;

drop policy if exists profiles_select on public.profiles;
drop policy if exists products_select on public.products;
drop policy if exists products_insert on public.products;
drop policy if exists products_update on public.products;
drop policy if exists customers_select on public.customers;
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_update on public.customers;
drop policy if exists orders_select on public.orders;
drop policy if exists orders_insert on public.orders;
drop policy if exists orders_update on public.orders;
drop policy if exists sales_select on public.sales;
drop policy if exists sales_insert on public.sales;
drop policy if exists sales_update on public.sales;
drop policy if exists closures_select on public.cash_closures;
drop policy if exists closures_insert on public.cash_closures;
drop policy if exists closures_update on public.cash_closures;
drop policy if exists settings_select on public.settings;
drop policy if exists settings_insert on public.settings;
drop policy if exists settings_update on public.settings;
drop policy if exists audit_select on public.audit_events;
drop policy if exists audit_insert on public.audit_events;
drop policy if exists history_select on public.history_records;
drop policy if exists history_insert on public.history_records;

create policy profiles_select on public.profiles for select to authenticated
using ((id = (select auth.uid())) or (select private.is_manager_or_admin()));
create policy products_select on public.products for select to authenticated using ((select private.is_active_user()));
create policy products_insert on public.products for insert to authenticated with check ((select private.is_active_user()) and (select private.has_permission('products.manage')));
create policy products_update on public.products for update to authenticated using ((select private.is_active_user()) and (select private.has_permission('products.manage'))) with check ((select private.is_active_user()) and (select private.has_permission('products.manage')));
create policy customers_select on public.customers for select to authenticated using ((select private.is_active_user()) and (select private.has_permission('customers.manage')));
create policy customers_insert on public.customers for insert to authenticated with check ((select private.is_active_user()) and (select private.has_permission('customers.manage')));
create policy customers_update on public.customers for update to authenticated using ((select private.is_active_user()) and (select private.has_permission('customers.manage'))) with check ((select private.is_active_user()) and (select private.has_permission('customers.manage')));
create policy orders_select on public.orders for select to authenticated using ((select private.is_active_user()) and (select private.has_permission('pos.access')));
create policy orders_insert on public.orders for insert to authenticated with check ((select private.is_active_user()) and (select private.has_permission('pos.access')));
create policy orders_update on public.orders for update to authenticated using ((select private.is_active_user()) and (select private.has_permission('pos.access'))) with check ((select private.is_active_user()) and (select private.has_permission('pos.access')));
create policy sales_select on public.sales for select to authenticated using ((select private.is_active_user()) and (select private.has_permission('sales.view')));
create policy sales_insert on public.sales for insert to authenticated with check ((select private.is_active_user()) and (select private.has_permission('pos.access')));
create policy sales_update on public.sales for update to authenticated using ((select private.is_active_user()) and (select private.has_permission('sales.delete'))) with check ((select private.is_active_user()) and (select private.has_permission('sales.delete')));
create policy closures_select on public.cash_closures for select to authenticated using ((select private.is_active_user()) and (select private.has_permission('cashClosing.access')));
create policy closures_insert on public.cash_closures for insert to authenticated with check ((select private.is_active_user()) and (select private.has_permission('cashClosing.access')));
create policy closures_update on public.cash_closures for update to authenticated using ((select private.is_active_user()) and (select private.has_permission('cashClosing.access'))) with check ((select private.is_active_user()) and (select private.has_permission('cashClosing.access')));
create policy settings_select on public.settings for select to authenticated using ((select private.is_active_user()));
create policy settings_insert on public.settings for insert to authenticated with check ((select private.is_active_user()) and (select private.is_manager_or_admin()));
create policy settings_update on public.settings for update to authenticated using ((select private.is_active_user()) and (select private.is_manager_or_admin())) with check ((select private.is_active_user()) and (select private.is_manager_or_admin()));
create policy audit_select on public.audit_events for select to authenticated using ((actor_id = (select auth.uid())::text) or (select private.is_manager_or_admin()));
create policy audit_insert on public.audit_events for insert to authenticated with check ((select private.is_active_user()));
create policy history_select on public.history_records for select to authenticated using ((select private.is_manager_or_admin()));
create policy history_insert on public.history_records for insert to authenticated with check ((select private.is_active_user()));

revoke all on table public.profiles, public.products, public.customers, public.orders, public.sales, public.cash_closures, public.settings, public.audit_events, public.history_records from anon;
revoke all on table public.profiles, public.products, public.customers, public.orders, public.sales, public.cash_closures, public.settings, public.audit_events, public.history_records from authenticated;
grant select on table public.profiles to authenticated;
grant select, insert, update on table public.products to authenticated;
grant select, insert, update on table public.customers to authenticated;
grant select, insert, update on table public.orders to authenticated;
grant select, insert, update on table public.sales to authenticated;
grant select, insert, update on table public.cash_closures to authenticated;
grant select, insert, update on table public.settings to authenticated;
grant select, insert on table public.audit_events to authenticated;
grant select, insert on table public.history_records to authenticated;

drop view if exists public.pos_login_profiles;
create view public.pos_login_profiles as
select id, name, role, rank, active, auth_email, legacy_id
from public.profiles;
comment on view public.pos_login_profiles is 'Lista mínima para selector de acceso; auth_email usa el dominio sintético smaky.local y no contiene secretos.';
grant select on public.pos_login_profiles to anon, authenticated;
