-- Inventory removal: remove an ingredient/product from active inventory while preserving
-- immutable movement and invoice history. Ingredients are also removed from future recipes.
begin;

alter table public.inventory_items
  add column if not exists removed_at timestamptz;

create index if not exists idx_inventory_items_removed_at
  on public.inventory_items(removed_at)
  where removed_at is not null;

create or replace function public.inventory_delete_item(p_item_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.inventory_items%rowtype;
  v_recipe_count integer := 0;
  v_movement_count integer := 0;
  v_removed_at timestamptz := now();
begin
  if not coalesce((select private.is_active_user()), false)
     or not coalesce((select private.has_permission('inventory.manage')), false) then
    raise exception 'No tienes permiso para administrar inventario.' using errcode = '42501';
  end if;

  if coalesce(trim(p_item_id), '') = '' then
    raise exception 'Selecciona un elemento válido del inventario.' using errcode = '22023';
  end if;

  select * into v_item
  from public.inventory_items
  where id = trim(p_item_id)
  for update;

  if not found then
    raise exception 'El elemento ya no existe en el inventario.' using errcode = 'P0002';
  end if;

  if v_item.removed_at is not null then
    return jsonb_build_object(
      'ok', true,
      'item_id', v_item.id,
      'record_kind', v_item.record_kind,
      'recipes_removed', 0,
      'movements_preserved', 0,
      'already_removed', true
    );
  end if;

  select count(*)::integer into v_movement_count
  from public.inventory_movements
  where inventory_item_id = v_item.id;

  if v_item.record_kind = 'ingredient' then
    delete from public.inventory_recipes
    where inventory_item_id = v_item.id;
    get diagnostics v_recipe_count = row_count;

    update public.inventory_items
    set active = false,
        removed_at = v_removed_at,
        updated_at = v_removed_at
    where id = v_item.id;
  else
    -- The catalog product itself remains sellable. Only remove its direct stock link,
    -- freeing the product to be linked again later. Keep the old ledger row for audit.
    update public.inventory_items
    set active = false,
        removed_at = v_removed_at,
        catalog_product_id = null,
        updated_at = v_removed_at
    where id = v_item.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'item_id', v_item.id,
    'record_kind', v_item.record_kind,
    'recipes_removed', v_recipe_count,
    'movements_preserved', v_movement_count,
    'removed_at', v_removed_at
  );
end;
$$;

revoke all on function public.inventory_delete_item(text) from public, anon;
grant execute on function public.inventory_delete_item(text) to authenticated;

commit;
