-- Customer 360° profile. Statistics are calculated from the authoritative sales
-- rows in Supabase; this function does not duplicate sales or customer records.
create index if not exists idx_sales_customer_created_at_active
  on public.sales (customer_id, created_at desc, id desc)
  where deleted_at is null;

-- Compatibility for older synchronized invoices whose customer id only exists in the JSON snapshot.
create index if not exists idx_sales_legacy_data_customer_created_at_active
  on public.sales ((data ->> 'customerId'), created_at desc, id desc)
  where deleted_at is null and customer_id is null;

create or replace function public.customer_profile_360(
  p_customer_id text,
  p_history_offset integer default 0,
  p_history_limit integer default 10
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_offset integer := greatest(0, least(coalesce(p_history_offset, 0), 1000000));
  v_limit integer := greatest(1, least(coalesce(p_history_limit, 10), 50));
  v_can_view_sales boolean := false;
  v_result jsonb;
begin
  if not coalesce((select private.is_active_user()), false)
     or not coalesce((select private.has_permission('customers.manage')), false) then
    raise exception 'No tienes permiso para consultar el perfil del cliente.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.active = true
  ) then
    raise exception 'El cliente no existe o ya no está activo.' using errcode = 'P0002';
  end if;

  v_can_view_sales := coalesce((select private.has_permission('sales.view')), false);
  if not v_can_view_sales then
    return jsonb_build_object(
      'canViewPurchases', false,
      'summary', jsonb_build_object(
        'totalSales', 0, 'totalSpent', 0, 'averageTicket', 0,
        'firstPurchaseAt', null, 'lastPurchaseAt', null
      ),
      'favoriteProducts', '[]'::jsonb,
      'frequentObservations', '[]'::jsonb,
      'sales', '[]'::jsonb,
      'hasMore', false
    );
  end if;

  with customer_sales as materialized (
    select
      s.id,
      s.created_at,
      s.updated_at,
      s.customer_id,
      s.order_number,
      s.payment,
      s.total,
      coalesce(s.data, '{}'::jsonb) as sale_data
    from public.sales s
    where s.deleted_at is null
      and coalesce(s.data ->> 'deletedAt', '') = ''
      and (
        s.customer_id = p_customer_id
        or (s.customer_id is null and s.data ->> 'customerId' = p_customer_id)
      )
  ),
  stats as (
    select
      count(*)::integer as total_sales,
      coalesce(sum(total), 0)::numeric as total_spent,
      coalesce(avg(total), 0)::numeric as average_ticket,
      min(created_at) as first_purchase_at,
      max(created_at) as last_purchase_at
    from customer_sales
  ),
  sale_items as (
    select
      cs.id as sale_id,
      cs.total as sale_total,
      item.value as item
    from customer_sales cs
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(cs.sale_data -> 'items') = 'array'
        then cs.sale_data -> 'items' else '[]'::jsonb end
    ) as item(value)
  ),
  favorite_products as (
    select
      coalesce(nullif(item ->> 'productId', ''), nullif(item ->> 'name', ''), 'unknown') as product_id,
      coalesce(nullif(item ->> 'name', ''), 'Producto') as name,
      sum(case when coalesce(item ->> 'quantity', '') ~ '^[0-9]+([.][0-9]+)?$'
        then (item ->> 'quantity')::numeric else 1 end) as quantity,
      count(distinct sale_id)::integer as orders,
      sum(case when coalesce(item ->> 'total', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (item ->> 'total')::numeric else 0 end) as total_spent
    from sale_items
    group by 1, 2
  ),
  favorite_products_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'productId', product_id,
      'name', name,
      'quantity', quantity,
      'orders', orders,
      'totalSpent', total_spent
    ) order by quantity desc, name asc), '[]'::jsonb) as value
    from (select * from favorite_products order by quantity desc, name asc limit 5) ranked
  ),
  observation_tokens as (
    select
      lower(btrim(token.value)) as normalized,
      min(btrim(token.value)) as display_text,
      sum(case when coalesce(si.item ->> 'quantity', '') ~ '^[0-9]+([.][0-9]+)?$'
        then (si.item ->> 'quantity')::numeric else 1 end) as occurrences
    from sale_items si
    cross join lateral regexp_split_to_table(
      coalesce(si.item ->> 'modification', ''), E'[,;\n]+'
    ) as token(value)
    where nullif(btrim(token.value), '') is not null
    group by lower(btrim(token.value))
  ),
  observations_json as (
    select coalesce(jsonb_agg(jsonb_build_object('text', display_text, 'count', occurrences)
      order by occurrences desc, display_text asc), '[]'::jsonb) as value
    from (select * from observation_tokens order by occurrences desc, display_text asc limit 10) ranked
  ),
  recent_slice as (
    select cs.*
    from customer_sales cs
    order by cs.created_at desc, cs.id desc
    offset v_offset limit (v_limit + 1)
  ),
  recent_page as (
    select recent_slice.*, row_number() over (order by recent_slice.created_at desc, recent_slice.id desc) as rn
    from recent_slice
  ),
  recent_json as (
    select
      coalesce(jsonb_agg(
        (sale_data || jsonb_build_object(
          'id', id,
          'createdAt', created_at,
          'updatedAt', updated_at,
          'customerId', coalesce(customer_id, sale_data ->> 'customerId'),
          'orderNumber', order_number,
          'payment', payment,
          'total', total
        )) order by created_at desc, id desc
      ) filter (where rn <= v_limit), '[]'::jsonb) as sales,
      count(*) > v_limit as has_more
    from recent_page
  )
  select jsonb_build_object(
    'canViewPurchases', true,
    'summary', jsonb_build_object(
      'totalSales', stats.total_sales,
      'totalSpent', stats.total_spent,
      'averageTicket', stats.average_ticket,
      'firstPurchaseAt', stats.first_purchase_at,
      'lastPurchaseAt', stats.last_purchase_at
    ),
    'favoriteProducts', favorite_products_json.value,
    'frequentObservations', observations_json.value,
    'sales', recent_json.sales,
    'hasMore', recent_json.has_more
  )
  into v_result
  from stats cross join favorite_products_json cross join observations_json cross join recent_json;

  return v_result;
end;
$$;

revoke all on function public.customer_profile_360(text, integer, integer) from public, anon;
grant execute on function public.customer_profile_360(text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
