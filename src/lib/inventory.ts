import { supabase } from './supabase'
import type { InventoryItem, InventoryMovement, InventoryRecipe, InventoryRecipeProduct, InventoryUnitKind } from './types'

type RemoteRow = Record<string, any>

export type InventorySnapshot = {
  items: InventoryItem[]
  recipes: InventoryRecipe[]
  productComponents: InventoryRecipeProduct[]
  movements: InventoryMovement[]
}

export type CreateInventoryItemInput = {
  id: string
  name: string
  category: string
  unit: string
  initialQuantity: number
  lowStockQuantity: number | null
  note: string
}

export type InventoryRecipeInput = {
  inventoryItemId: string
  quantity: number
  unit: string
}

export type InventoryRecipeProductInput = {
  componentProductId: string
  quantity: number
}

export type InventoryShortage = {
  inventoryItemId: string
  itemName: string
  unit: string
  availableQuantity: number
  requiredQuantity: number
  shortageQuantity: number
}

function requiredClient() {
  if (!supabase) throw new Error('Supabase no está configurado en esta instalación.')
  return supabase
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const value = error as { message?: string; details?: string; hint?: string }
    const primary = String(value.message || '').trim()
    const details = String(value.details || '').trim()
    const hint = String(value.hint || '').trim()
    return [primary || fallback, details, hint].filter(Boolean).join(' · ')
  }
  return error instanceof Error ? error.message : fallback
}

export function unitMetadata(unitInput: string): { unitKind: InventoryUnitKind; baseUnit: string; factor: number } {
  const unit = unitInput.trim().toLowerCase()
  if (['kg', 'kilogramo', 'kilogramos'].includes(unit)) return { unitKind: 'mass', baseUnit: 'g', factor: 1000 }
  if (['g', 'gramo', 'gramos'].includes(unit)) return { unitKind: 'mass', baseUnit: 'g', factor: 1 }
  if (['l', 'litro', 'litros'].includes(unit)) return { unitKind: 'volume', baseUnit: 'ml', factor: 1000 }
  if (['ml', 'mililitro', 'mililitros'].includes(unit)) return { unitKind: 'volume', baseUnit: 'ml', factor: 1 }
  return { unitKind: 'custom', baseUnit: unitInput.trim(), factor: 1 }
}

export function recipeUnits(item: InventoryItem): string[] {
  if (item.unitKind === 'mass') return ['g', 'kg']
  if (item.unitKind === 'volume') return ['ml', 'L']
  return [item.unit]
}

export function toDisplayQuantity(baseQuantity: number, factor: number): number {
  return baseQuantity / (factor || 1)
}

export function formatQuantity(value: number, maximumFractionDigits = 3): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits, minimumFractionDigits: 0 }).format(Number.isFinite(value) ? value : 0)
}

function mapItem(row: RemoteRow): InventoryItem {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    category: String(row.category || ''),
    recordKind: row.record_kind === 'catalog_product' ? 'catalog_product' : 'ingredient',
    catalogProductId: row.catalog_product_id ? String(row.catalog_product_id) : undefined,
    unit: String(row.unit || ''),
    unitKind: (row.unit_kind || 'custom') as InventoryUnitKind,
    baseUnit: String(row.base_unit || row.unit || ''),
    unitFactor: Number(row.unit_factor) || 1,
    stockBase: Number(row.stock_base) || 0,
    lowStockBase: row.low_stock_base === null || row.low_stock_base === undefined ? null : Number(row.low_stock_base),
    active: Boolean(row.active),
    note: String(row.note || ''),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
    createdBy: row.created_by ? String(row.created_by) : undefined,
    createdByName: row.created_by_name ? String(row.created_by_name) : undefined,
  }
}

function mapRecipe(row: RemoteRow): InventoryRecipe {
  return {
    id: String(row.id),
    productId: String(row.product_id || ''),
    productName: String(row.product_name || ''),
    inventoryItemId: String(row.inventory_item_id || ''),
    itemName: String(row.item_name || ''),
    quantityBase: Number(row.quantity_base) || 0,
    quantityDisplay: Number(row.quantity_display) || 0,
    quantityUnit: String(row.quantity_unit || ''),
    quantityFactor: Number(row.quantity_factor) || 1,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

function mapProductComponent(row: RemoteRow): InventoryRecipeProduct {
  return {
    id: String(row.id),
    productId: String(row.product_id || ''),
    productName: String(row.product_name || ''),
    componentProductId: String(row.component_product_id || ''),
    componentProductName: String(row.component_product_name || ''),
    quantity: Number(row.quantity) || 0,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

function mapMovement(row: RemoteRow): InventoryMovement {
  return {
    id: String(row.id),
    inventoryItemId: String(row.inventory_item_id || ''),
    itemName: String(row.item_name || ''),
    movementType: row.movement_type,
    quantityBase: Number(row.quantity_base) || 0,
    displayQuantity: Number(row.display_quantity) || 0,
    displayUnit: String(row.display_unit || ''),
    stockBeforeBase: Number(row.stock_before_base) || 0,
    stockAfterBase: Number(row.stock_after_base) || 0,
    reason: String(row.reason || ''),
    occurredAt: String(row.occurred_at || ''),
    actorId: row.actor_id ? String(row.actor_id) : undefined,
    actorName: String(row.actor_name || ''),
    saleId: row.sale_id ? String(row.sale_id) : undefined,
    saleOrderNumber: row.sale_order_number === null || row.sale_order_number === undefined ? undefined : Number(row.sale_order_number),
    saleTotal: row.sale_total === null || row.sale_total === undefined ? undefined : Number(row.sale_total),
    salePayment: row.sale_payment ? String(row.sale_payment) : undefined,
    saleSnapshot: row.sale_snapshot && typeof row.sale_snapshot === 'object' ? row.sale_snapshot as Record<string, unknown> : null,
    productId: row.product_id ? String(row.product_id) : undefined,
    productName: row.product_name ? String(row.product_name) : undefined,
    soldProductQuantity: row.sold_product_quantity === null || row.sold_product_quantity === undefined ? undefined : Number(row.sold_product_quantity),
    saleLineIndex: row.sale_line_index === null || row.sale_line_index === undefined ? undefined : Number(row.sale_line_index),
    reversalOf: row.reversal_of ? String(row.reversal_of) : undefined,
  }
}

export async function getInventorySnapshot(): Promise<InventorySnapshot> {
  const client = requiredClient()
  const [itemsResult, recipesResult, productComponentsResult, movementsResult] = await Promise.all([
    client.from('inventory_items').select('*').order('name', { ascending: true }),
    client.from('inventory_recipes').select('*').order('product_name', { ascending: true }),
    client.from('inventory_recipe_products').select('*').order('product_name', { ascending: true }),
    client.from('inventory_movements').select('*').order('occurred_at', { ascending: false }).order('id', { ascending: false }).range(0, 599),
  ])
  const failed = [itemsResult.error, recipesResult.error, productComponentsResult.error, movementsResult.error].find(Boolean)
  if (failed) throw new Error(errorMessage(failed, 'No fue posible leer el inventario desde Supabase.'))
  return {
    items: (itemsResult.data || []).map(mapItem),
    recipes: (recipesResult.data || []).map(mapRecipe),
    productComponents: (productComponentsResult.data || []).map(mapProductComponent),
    movements: (movementsResult.data || []).map(mapMovement),
  }
}

export async function getInventoryMovementPage(offset: number, pageSize = 300): Promise<InventoryMovement[]> {
  const client = requiredClient()
  const safeOffset = Math.max(0, Math.floor(offset))
  const safePageSize = Math.min(500, Math.max(1, Math.floor(pageSize)))
  const { data, error } = await client.from('inventory_movements').select('*')
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .range(safeOffset, safeOffset + safePageSize - 1)
  if (error) throw new Error(errorMessage(error, 'No fue posible cargar más movimientos del inventario.'))
  return (data || []).map(mapMovement)
}

export async function createInventoryItem(input: CreateInventoryItemInput): Promise<InventoryItem> {
  const client = requiredClient()
  const { data, error } = await client.rpc('inventory_create_item', {
    p_id: input.id,
    p_name: input.name.trim(),
    p_category: input.category.trim(),
    p_unit: input.unit.trim(),
    p_initial_quantity: input.initialQuantity,
    p_low_stock_quantity: input.lowStockQuantity,
    p_note: input.note.trim(),
  })
  if (error) throw new Error(errorMessage(error, 'No fue posible crear el ingrediente.'))
  return mapItem(data as RemoteRow)
}


export async function linkCatalogProductToInventory(input: { productId: string; initialQuantity: number; lowStockQuantity: number | null }): Promise<InventoryItem> {
  const client = requiredClient()
  const { data, error } = await client.rpc('inventory_link_catalog_product', {
    p_product_id: input.productId,
    p_initial_quantity: input.initialQuantity,
    p_low_stock_quantity: input.lowStockQuantity,
  })
  if (error) throw new Error(errorMessage(error, 'No fue posible agregar el producto al inventario.'))
  return mapItem(data as RemoteRow)
}

export async function deleteCatalogProductWithInventory(productId: string): Promise<void> {
  const client = requiredClient()
  const { error } = await client.rpc('inventory_delete_catalog_product', { p_product_id: productId })
  if (error) throw new Error(errorMessage(error, 'No fue posible eliminar el producto y sus datos de inventario.'))
}

export async function updateInventoryItem(item: InventoryItem, changes: { name: string; category: string; lowStockQuantity: number | null; note: string }): Promise<InventoryItem> {
  const client = requiredClient()
  const { data, error } = await client.rpc('inventory_update_item', {
    p_item_id: item.id,
    p_name: changes.name.trim(),
    p_category: changes.category.trim(),
    p_low_stock_quantity: changes.lowStockQuantity,
    p_note: changes.note.trim(),
  })
  if (error) throw new Error(errorMessage(error, 'No fue posible actualizar el ingrediente.'))
  return mapItem(data as RemoteRow)
}

export async function adjustInventoryStock(input: { movementId: string; itemId: string; quantity: number; movementType: 'entry' | 'exit'; reason: string; occurredAt: string }): Promise<InventoryMovement> {
  const client = requiredClient()
  const { data, error } = await client.rpc('inventory_apply_movement', {
    p_movement_id: input.movementId,
    p_item_id: input.itemId,
    p_quantity: input.quantity,
    p_movement_type: input.movementType,
    p_reason: input.reason.trim(),
    p_occurred_at: input.occurredAt,
  })
  if (error) throw new Error(errorMessage(error, 'No fue posible registrar el movimiento de inventario.'))
  return mapMovement(data as RemoteRow)
}

export async function setInventoryItemActive(itemId: string, active: boolean): Promise<InventoryItem> {
  const client = requiredClient()
  const { data, error } = await client.rpc('inventory_set_item_active', { p_item_id: itemId, p_active: active })
  if (error) throw new Error(errorMessage(error, 'No fue posible actualizar el ingrediente.'))
  return mapItem(data as RemoteRow)
}

export async function saveProductRecipe(productId: string, productName: string, rows: InventoryRecipeInput[], components: InventoryRecipeProductInput[] = []): Promise<void> {
  const client = requiredClient()
  const { error } = await client.rpc('inventory_save_product_recipe_v2', {
    p_product_id: productId,
    p_product_name: productName,
    p_rows: rows.map(row => ({ inventory_item_id: row.inventoryItemId, quantity: row.quantity, unit: row.unit })),
    p_product_components: components.map(component => ({ component_product_id: component.componentProductId, quantity: component.quantity })),
  })
  if (error) throw new Error(errorMessage(error, 'No fue posible guardar la receta.'))
}


export async function checkInventorySaleShortages(items: Array<{ productId: string; name: string; quantity: number }>): Promise<InventoryShortage[]> {
  const client = requiredClient()
  const { data, error } = await client.rpc('inventory_check_sale_shortages', {
    p_items: items.map(item => ({ productId: item.productId, name: item.name, quantity: item.quantity })),
  })
  if (error) throw new Error(errorMessage(error, 'No fue posible comprobar las existencias.'))
  return ((data || []) as RemoteRow[]).map(row => ({
    inventoryItemId: String(row.inventory_item_id || ''),
    itemName: String(row.item_name || 'Ingrediente'),
    unit: String(row.display_unit || ''),
    availableQuantity: Number(row.available_quantity) || 0,
    requiredQuantity: Number(row.required_quantity) || 0,
    shortageQuantity: Number(row.shortage_quantity) || 0,
  }))
}

export function subscribeInventoryChanges(onChange: () => void): () => void {
  if (!supabase) return () => undefined
  const channel = supabase.channel(`inventory-live-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_recipes' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_recipe_products' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, onChange)
    .subscribe()
  return () => { void supabase?.removeChannel(channel) }
}
