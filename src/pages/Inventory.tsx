import {
  Archive, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Bell, Boxes, CalendarClock,
  Check, CheckCircle2, ChevronDown, CircleDashed, ClipboardList, Clock3, FileText, History, Package, PackagePlus,
  Pencil, Plus, Printer, RefreshCw, Search, ShieldAlert, SlidersHorizontal,
  Tag, Trash2, Utensils, WalletCards, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { getSessionUser, hasPermission } from '../lib/auth'
import { DEFAULT_INVENTORY_UNITS, getAllProducts, getInventoryUnits } from '../lib/store'
import { date, money, time } from '../lib/format'
import { printSaleReceipt } from '../lib/print'
import {
  adjustInventoryStock, createInventoryItem, deleteInventoryItem, formatQuantity, getInventoryMovementPage, getInventorySnapshot,
  linkCatalogProductToInventory, recipeUnits, saveProductRecipe, setInventoryItemActive, subscribeInventoryChanges,
  toDisplayQuantity, updateInventoryItem, unitMetadata,
  type InventorySnapshot, type InventoryRecipeProductInput,
} from '../lib/inventory'
import type { InventoryItem, InventoryMovement, Product, Sale } from '../lib/types'

const emptySnapshot: InventorySnapshot = { items: [], recipes: [], productComponents: [], movements: [] }
const reasonsByType = {
  entry: ['Compra / reposición', 'Devolución', 'Ajuste de conteo', 'Otro'],
  exit: ['Merma / desperdicio', 'Uso interno', 'Ajuste de conteo', 'Otro'],
} as const

type ItemForm = { name: string; category: string; unit: string; initialQuantity: string; lowStockQuantity: string; note: string }
type MovementForm = { movementType: 'entry' | 'exit'; quantity: string; occurredAt: string; reason: string }
type RecipeDraftRow = { inventoryItemId: string; quantity: string; unit: string }
type RecipeComponentDraftRow = { componentProductId: string; quantity: string }
type CatalogProductForm = { productId: string; initialQuantity: string; lowStockQuantity: string }
type InventoryNotification = { id: string; type: 'low_stock'; title: string; description: string; itemId: string; recordKind: 'ingredient' | 'catalog_product' }

function localDateTimeValue() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 16)
}

function itemDisplayStock(item: InventoryItem) {
  return toDisplayQuantity(item.stockBase, item.unitFactor)
}

function itemDisplayMinimum(item: InventoryItem) {
  return item.lowStockBase === null ? null : toDisplayQuantity(item.lowStockBase, item.unitFactor)
}

function movementLabel(movement: InventoryMovement) {
  switch (movement.movementType) {
    case 'initial_stock': return 'Existencia inicial'
    case 'entry': return 'Entrada manual'
    case 'exit': return 'Salida manual'
    case 'sale_consumption': return 'Consumo por venta'
    case 'sale_reversal': return 'Reversión de venta'
    default: return movement.movementType
  }
}

function itemTone(item: InventoryItem) {
  if (item.stockBase < 0) return 'negative'
  if (item.lowStockBase !== null && item.stockBase <= item.lowStockBase) return 'low'
  return 'good'
}

function normalizeSaleSnapshot(movement: InventoryMovement): Sale | null {
  const snapshot = movement.saleSnapshot
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.items)) return null
  return snapshot as unknown as Sale
}

function notifyCatalogProductLinked(productId: string) {
  const linkSignal = { productId, at: Date.now() }
  try { localStorage.setItem('smaky-inventory-catalog-linked', JSON.stringify(linkSignal)) } catch { /* BroadcastChannel below is the primary cross-tab signal */ }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('smaky-inventory-catalog-link')
      channel.postMessage(linkSignal)
      channel.close()
    }
  } catch { /* the POS can refresh inventory state on the next open */ }
}

export function Inventory() {
  const user = getSessionUser()
  const [snapshot, setSnapshot] = useState<InventorySnapshot>(emptySnapshot)
  const [products, setProducts] = useState<Product[]>([])
  const [measurementUnits, setMeasurementUnits] = useState<string[]>(DEFAULT_INVENTORY_UNITS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [activeTab, setActiveTab] = useState<'stock' | 'products' | 'recipes' | 'history'>('stock')
  const [recipeSearch, setRecipeSearch] = useState('')
  const [recipeFilter, setRecipeFilter] = useState<'all' | 'configured' | 'pending'>('all')
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showEntryChoice, setShowEntryChoice] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [showCatalogProductForm, setShowCatalogProductForm] = useState(false)
  const [catalogProductForm, setCatalogProductForm] = useState<CatalogProductForm>({ productId: '', initialQuantity: '0', lowStockQuantity: '' })
  const [requestedCatalogProductId, setRequestedCatalogProductId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('linkProductId'))
  const [lockedCatalogProductId, setLockedCatalogProductId] = useState<string | null>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  const [itemForm, setItemForm] = useState<ItemForm>({ name: '', category: '', unit: 'unidad', initialQuantity: '0', lowStockQuantity: '', note: '' })
  const [movementItem, setMovementItem] = useState<InventoryItem | null>(null)
  const [movementForm, setMovementForm] = useState<MovementForm>({ movementType: 'entry', quantity: '', occurredAt: localDateTimeValue(), reason: 'Compra / reposición' })
  const [recipeProduct, setRecipeProduct] = useState<Product | null>(null)
  const [recipeDraft, setRecipeDraft] = useState<RecipeDraftRow[]>([])
  const [recipeComponentDraft, setRecipeComponentDraft] = useState<RecipeComponentDraftRow[]>([])
  const [historyItemId, setHistoryItemId] = useState('all')
  const [invoiceMovement, setInvoiceMovement] = useState<InventoryMovement | null>(null)
  const [showRecipeNotice, setShowRecipeNotice] = useState(false)
  const [loadingOlderMovements, setLoadingOlderMovements] = useState(false)
  const [hasMoreMovements, setHasMoreMovements] = useState(true)
  const [olderMovements, setOlderMovements] = useState<InventoryMovement[]>([])
  const movementHistoryInitialized = useRef(false)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setOlderMovements([])
      movementHistoryInitialized.current = false
    }
    try {
      const [next, productRows, units] = await Promise.all([getInventorySnapshot(), getAllProducts(), getInventoryUnits()])
      setSnapshot(next)
      setMeasurementUnits(units)
      if (!movementHistoryInitialized.current) {
        movementHistoryInitialized.current = true
        setHasMoreMovements(next.movements.length === 600)
      }
      setProducts(productRows.filter(product => !product.deletedAt))
      setPageError('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible cargar el inventario desde Supabase.'
      setPageError(message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = subscribeInventoryChanges(() => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => { void refresh(true) }, 220)
    })
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refresh(true)
    }, 20_000)
    const handleOnline = () => { void refresh(true) }
    const handleSettingsChange = () => { void getInventoryUnits().then(setMeasurementUnits).catch(() => undefined) }
    window.addEventListener('online', handleOnline)
    window.addEventListener('smaky-settings-change', handleSettingsChange)
    return () => {
      unsubscribe()
      if (refreshTimer) clearTimeout(refreshTimer)
      window.clearInterval(interval)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('smaky-settings-change', handleSettingsChange)
    }
  }, [refresh])


  useEffect(() => {
    if (!requestedCatalogProductId || loading) return
    const productId = requestedCatalogProductId
    const product = products.find(row => row.id === productId)
    const existing = snapshot.items.find(item => !item.removedAt && item.recordKind === 'catalog_product' && item.catalogProductId === productId && item.active)
    const url = new URL(window.location.href)
    url.searchParams.delete('linkProductId')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    setActiveTab('products')
    setRequestedCatalogProductId(null)
    if (existing) {
      notifyCatalogProductLinked(productId)
      setFeedback(`${product?.name || existing.name} ya está vinculado al inventario.`)
      return
    }
    if (!product || product.deletedAt || !product.active) {
      setPageError('El producto seleccionado ya no está activo en el catálogo. Vuelve al pedido y comprueba el producto.')
      return
    }
    setCatalogProductForm({ productId, initialQuantity: '0', lowStockQuantity: '' })
    setLockedCatalogProductId(productId)
    setPageError('')
    setFeedback('')
    setShowCatalogProductForm(true)
  }, [requestedCatalogProductId, loading, products, snapshot.items])

  const ingredientItems = useMemo(() => snapshot.items.filter(item => !item.removedAt && item.recordKind !== 'catalog_product'), [snapshot.items])
  const catalogStockItems = useMemo(() => snapshot.items.filter(item => !item.removedAt && item.recordKind === 'catalog_product'), [snapshot.items])
  const activeItems = useMemo(() => ingredientItems.filter(item => item.active), [ingredientItems])
  const activeCatalogItems = useMemo(() => catalogStockItems.filter(item => item.active), [catalogStockItems])
  const catalogDisplayName = (item: InventoryItem) => products.find(product => product.id === item.catalogProductId)?.name || item.name
  const filteredCatalogItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es')
    return activeCatalogItems.filter(item => !term || catalogDisplayName(item).toLocaleLowerCase('es').includes(term))
      .sort((a, b) => catalogDisplayName(a).localeCompare(catalogDisplayName(b), 'es'))
  }, [activeCatalogItems, products, search])
  const linkedCatalogProductIds = useMemo(() => new Set(catalogStockItems.map(item => item.catalogProductId).filter((id): id is string => Boolean(id))), [catalogStockItems])
  const availableCatalogProducts = useMemo(() => products.filter(product => product.active && !product.deletedAt && !linkedCatalogProductIds.has(product.id)), [products, linkedCatalogProductIds])
  const itemUnitOptions = useMemo(() => {
    const options = [...measurementUnits]
    if (editingItem?.unit && !options.some(unit => unit.toLocaleLowerCase('es') === editingItem.unit.toLocaleLowerCase('es'))) options.push(editingItem.unit)
    return options
  }, [measurementUnits, editingItem])
  const filteredItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es')
    return ingredientItems.filter(item => {
      if (!showArchived && !item.active) return false
      if (showArchived && item.active) return false
      return !term || item.name.toLocaleLowerCase('es').includes(term) || item.category.toLocaleLowerCase('es').includes(term)
    }).sort((a,b) => a.name.localeCompare(b.name,'es'))
  }, [ingredientItems, search, showArchived])
  const recipeProducts = useMemo(() => products.filter(product => product.active && !product.deletedAt), [products])
  const recipeCountByProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const recipe of snapshot.recipes) map.set(recipe.productId, (map.get(recipe.productId) || 0) + 1)
    for (const component of snapshot.productComponents) map.set(component.productId, (map.get(component.productId) || 0) + 1)
    return map
  }, [snapshot.recipes, snapshot.productComponents])
  const allActiveStockItems = useMemo(() => snapshot.items.filter(item => !item.removedAt && item.active), [snapshot.items])
  const lowCount = allActiveStockItems.filter(item => item.stockBase < 0 || (item.lowStockBase !== null && item.stockBase <= item.lowStockBase)).length
  const negativeCount = allActiveStockItems.filter(item => item.stockBase < 0).length
  const inventoryNotifications = useMemo<InventoryNotification[]>(() => snapshot.items
    .filter(item => !item.removedAt && item.active && item.lowStockBase !== null && item.stockBase <= item.lowStockBase)
    .map(item => ({ id: `low-stock:${item.id}`, type: 'low_stock', title: item.recordKind === 'catalog_product' ? (products.find(product => product.id === item.catalogProductId)?.name || item.name) : item.name, description: `${formatQuantity(itemDisplayStock(item))} ${item.unit} disponibles · alerta en ${formatQuantity(itemDisplayMinimum(item) ?? 0)} ${item.unit}`, itemId: item.id, recordKind: item.recordKind })), [snapshot.items, products])
  const allMovements = useMemo(() => {
    const byId = new Map<string, InventoryMovement>()
    for (const movement of olderMovements) byId.set(movement.id, movement)
    for (const movement of snapshot.movements) byId.set(movement.id, movement)
    return Array.from(byId.values()).sort((a, b) => {
      const timeDifference = Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
      return timeDifference || b.id.localeCompare(a.id)
    })
  }, [snapshot.movements, olderMovements])
  const movementsToday = allMovements.filter(movement => movement.occurredAt.slice(0,10) === new Date().toISOString().slice(0,10)).length
  const filteredMovements = useMemo(() => allMovements.filter(movement => historyItemId === 'all' || movement.inventoryItemId === historyItemId), [allMovements, historyItemId])

  const openCreateItem = () => {
    setPageError(''); setFeedback(''); setShowEntryChoice(true)
  }

  const openCreateIngredient = () => {
    setShowEntryChoice(false)
    setEditingItem(null)
    setItemForm({ name: '', category: '', unit: 'unidad', initialQuantity: '0', lowStockQuantity: '', note: '' })
    setPageError(''); setFeedback(''); setShowItemForm(true)
  }

  const openLinkCatalogProduct = () => {
    setShowEntryChoice(false)
    setCatalogProductForm({ productId: '', initialQuantity: '0', lowStockQuantity: '' })
    setLockedCatalogProductId(null)
    setPageError(''); setFeedback(''); setShowCatalogProductForm(true)
  }

  const saveCatalogProductLink = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    const productId = catalogProductForm.productId
    const initialQuantity = Number(catalogProductForm.initialQuantity || 0)
    const low = catalogProductForm.lowStockQuantity.trim() === '' ? null : Number(catalogProductForm.lowStockQuantity)
    if (!productId) { setPageError('Selecciona un producto del catálogo.'); return }
    if (!Number.isFinite(initialQuantity) || !Number.isInteger(initialQuantity)) { setPageError('La existencia de un producto de catálogo se cuenta en unidades enteras: 1, 2, 3…'); return }
    if (low !== null && (!Number.isFinite(low) || low < 0 || !Number.isInteger(low))) { setPageError('El nivel de alerta debe ser un número entero de unidades.'); return }
    setSaving(true); setPageError(''); setFeedback('')
    try {
      await linkCatalogProductToInventory({ productId, initialQuantity, lowStockQuantity: low })
      notifyCatalogProductLinked(productId)
      setShowCatalogProductForm(false)
      setLockedCatalogProductId(null)
      setActiveTab('products')
      setFeedback('Producto vinculado al inventario. Las ventas descontarán su existencia automáticamente.')
      await refresh(true)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'No fue posible agregar el producto al inventario.')
    } finally { setSaving(false) }
  }

  const openEditItem = (item: InventoryItem) => {
    setEditingItem(item)
    setItemForm({ name: item.name, category: item.category, unit: item.unit, initialQuantity: '0', lowStockQuantity: itemDisplayMinimum(item) === null ? '' : String(itemDisplayMinimum(item)), note: item.note })
    setPageError(''); setFeedback(''); setShowItemForm(true)
  }

  const saveItem = async (event: FormEvent) => {
    event.preventDefault()
    if (!user || saving) return
    const name = itemForm.name.trim()
    const unit = itemForm.unit.trim()
    const initialQuantity = Number(itemForm.initialQuantity || 0)
    const low = itemForm.lowStockQuantity.trim() === '' ? null : Number(itemForm.lowStockQuantity)
    const usesWholeUnits = unitMetadata(unit).unitKind === 'custom'
    if (!name) { setPageError('Escribe el nombre del ingrediente o insumo.'); return }
    if (!unit) { setPageError('Elige o escribe la unidad de medida.'); return }
    if (!Number.isFinite(initialQuantity)) { setPageError('La existencia inicial debe ser un número válido.'); return }
    if (usesWholeUnits && !Number.isInteger(initialQuantity)) { setPageError('Esta unidad se cuenta en números enteros: 1, 2, 3…'); return }
    if (low !== null && (!Number.isFinite(low) || low < 0)) { setPageError('El mínimo de existencias debe ser cero o mayor.'); return }
    if (usesWholeUnits && low !== null && !Number.isInteger(low)) { setPageError('El nivel de alerta debe ser un número entero para esta unidad.'); return }
    setSaving(true); setPageError(''); setFeedback('')
    try {
      if (editingItem) {
        await updateInventoryItem(editingItem, { name, category: editingItem.category, lowStockQuantity: low, note: editingItem.note })
        setFeedback(editingItem.recordKind === 'catalog_product' ? 'Alerta de existencias actualizada.' : 'Ingrediente actualizado.')
      } else {
        await createInventoryItem({ id: crypto.randomUUID(), name, category: '', unit, initialQuantity, lowStockQuantity: low, note: '' })
        setFeedback('Ingrediente agregado al inventario.')
      }
      setShowItemForm(false)
      await refresh(true)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'No fue posible guardar el ingrediente.')
    } finally { setSaving(false) }
  }

  const removeInventoryEntry = async () => {
    if (!editingItem || saving) return
    if (!navigator.onLine) {
      setPageError('Conéctate a internet para eliminarlo de todos los dispositivos.')
      return
    }
    const item = editingItem
    const recipeCount = snapshot.recipes.filter(recipe => recipe.inventoryItemId === item.id).length
    const message = item.recordKind === 'catalog_product'
      ? `¿Quitar “${item.name}” del inventario?\n\nEl producto seguirá existiendo y vendiéndose en el catálogo, pero dejará de tener control de existencias. Podrás volver a vincularlo después.\n\nSe conservarán los movimientos históricos y las facturas relacionadas. Esta acción no se puede deshacer desde aquí.`
      : `¿Eliminar “${item.name}” del inventario?\n\nSe retirará de ${recipeCount} receta(s) y dejará de descontarse en nuevas ventas. Se conservarán los movimientos históricos y las facturas relacionadas.\n\nEsta acción no se puede deshacer desde aquí.`
    if (!window.confirm(message)) return
    setSaving(true)
    setPageError('')
    setFeedback('')
    try {
      const result = await deleteInventoryItem(item.id)
      setShowItemForm(false)
      setEditingItem(null)
      setFeedback(item.recordKind === 'catalog_product'
        ? 'Se quitó el control de inventario. El producto del catálogo sigue disponible y el historial se conservó.'
        : `Ingrediente eliminado del inventario. Se retiró de ${result.recipesRemoved} receta(s); se conservaron ${result.movementsPreserved} movimiento(s) históricos.`)
      await refresh(true)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'No fue posible eliminar el elemento del inventario.')
    } finally { setSaving(false) }
  }

  const openMovement = (item: InventoryItem, movementType: 'entry' | 'exit') => {
    setMovementItem(item)
    setMovementForm({ movementType, quantity: '', occurredAt: localDateTimeValue(), reason: movementType === 'entry' ? 'Compra / reposición' : 'Merma / desperdicio' })
    setPageError(''); setFeedback('')
  }

  const saveMovement = async (event: FormEvent) => {
    event.preventDefault()
    if (!movementItem || saving) return
    const rawQuantity = Number(movementForm.quantity)
    const usesWholeUnits = movementItem.unitKind === 'custom'
    if (!Number.isFinite(rawQuantity) || rawQuantity <= 0) { setPageError('La cantidad debe ser mayor que cero.'); return }
    if (usesWholeUnits && !Number.isInteger(rawQuantity)) { setPageError('Esta existencia se cuenta en unidades enteras: escribe 1, 2, 3…'); return }
    const quantity = usesWholeUnits ? rawQuantity : Math.round(rawQuantity * 1000) / 1000
    if (!movementForm.reason.trim()) { setPageError('Escribe el motivo del movimiento.'); return }
    const occurredAt = new Date(movementForm.occurredAt).toISOString()
    setSaving(true); setPageError(''); setFeedback('')
    try {
      await adjustInventoryStock({ movementId: crypto.randomUUID(), itemId: movementItem.id, quantity, movementType: movementForm.movementType, reason: movementForm.reason, occurredAt })
      setMovementItem(null)
      setFeedback(`${movementForm.movementType === 'entry' ? 'Entrada' : 'Salida'} registrada. Existencias actualizadas.`)
      await refresh(true)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'No fue posible registrar el movimiento.')
    } finally { setSaving(false) }
  }

  const archiveItem = async (item: InventoryItem) => {
    if (saving) return
    const nextActive = !item.active
    const message = nextActive ? `¿Reactivar “${item.name}”?` : `¿Archivar “${item.name}”? El ingrediente no se borrará del historial.`
    if (!window.confirm(message)) return
    setSaving(true); setPageError(''); setFeedback('')
    try {
      await setInventoryItemActive(item.id, nextActive)
      setFeedback(nextActive ? 'Ingrediente reactivado.' : 'Ingrediente archivado. El historial se conserva.')
      await refresh(true)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'No fue posible archivar el ingrediente.')
    } finally { setSaving(false) }
  }

  const openRecipe = (product: Product) => {
    setRecipeProduct(product)
    setPageError(''); setFeedback('')
    const existing = snapshot.recipes.filter(recipe => recipe.productId === product.id)
    const existingComponents = snapshot.productComponents.filter(component => component.productId === product.id)
    setRecipeDraft(existing.map(recipe => ({ inventoryItemId: recipe.inventoryItemId, quantity: String(recipe.quantityDisplay), unit: recipe.quantityUnit })))
    setRecipeComponentDraft(existingComponents.map(component => ({ componentProductId: component.componentProductId, quantity: String(component.quantity) })))
  }

  const updateRecipeRow = (index: number, changes: Partial<RecipeDraftRow>) => {
    setRecipeDraft(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...changes } : row))
  }

  const saveRecipe = async () => {
    if (!recipeProduct || saving) return
    const rows = recipeDraft.filter(row => row.inventoryItemId && row.quantity.trim() !== '')
    const components = recipeComponentDraft.filter(row => row.componentProductId && row.quantity.trim() !== '')
    for (const row of rows) {
      const amount = Number(row.quantity)
      if (!Number.isFinite(amount) || amount <= 0) { setPageError('Cada ingrediente necesita una cantidad mayor que cero.'); return }
    }
    const uniqueIds = new Set(rows.map(row => row.inventoryItemId))
    if (uniqueIds.size !== rows.length) { setPageError('No repitas el mismo ingrediente; edita su cantidad en una sola línea.'); return }
    for (const component of components) {
      const amount = Number(component.quantity)
      if (!Number.isFinite(amount) || amount <= 0) { setPageError('Cada producto incluido necesita una cantidad mayor que cero.'); return }
      if (component.componentProductId === recipeProduct.id) { setPageError('Un producto no puede incluirse a sí mismo.'); return }
    }
    const uniqueComponents = new Set(components.map(row => row.componentProductId))
    if (uniqueComponents.size !== components.length) { setPageError('No repitas el mismo producto incluido; aumenta su cantidad en una sola línea.'); return }
    const hadExistingRecipe = snapshot.recipes.some(recipe => recipe.productId === recipeProduct.id) || snapshot.productComponents.some(component => component.productId === recipeProduct.id)
    if (!rows.length && !components.length && hadExistingRecipe) {
      if (!window.confirm(`¿Quitar todos los ingredientes y productos incluidos de ${recipeProduct.name}? El producto seguirá vendiéndose, sin descontar inventario.`)) return
    }
    setSaving(true); setPageError(''); setFeedback('')
    try {
      await saveProductRecipe(
        recipeProduct.id, recipeProduct.name,
        rows.map(row => ({ inventoryItemId: row.inventoryItemId, quantity: Number(row.quantity), unit: row.unit })),
        components.map(row => ({ componentProductId: row.componentProductId, quantity: Number(row.quantity) }))
      )
      setRecipeProduct(null)
      setFeedback(rows.length || components.length ? `Receta de “${recipeProduct.name}” guardada.` : `“${recipeProduct.name}” quedó sin consumo de inventario.`)
      await refresh(true)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'No fue posible guardar la receta.')
    } finally { setSaving(false) }
  }

  const startInvoice = (movement: InventoryMovement) => {
    if (normalizeSaleSnapshot(movement)) setInvoiceMovement(movement)
  }

  const loadOlderMovements = async () => {
    if (loadingOlderMovements || !hasMoreMovements) return
    setLoadingOlderMovements(true)
    setPageError('')
    try {
      const loadedIds = new Set([...snapshot.movements, ...olderMovements].map(movement => movement.id))
      const page = await getInventoryMovementPage(loadedIds.size, 300)
      const currentRecentIds = new Set(snapshot.movements.map(movement => movement.id))
      setOlderMovements(current => {
        const merged = new Map<string, InventoryMovement>()
        for (const movement of current) merged.set(movement.id, movement)
        for (const movement of page) if (!currentRecentIds.has(movement.id)) merged.set(movement.id, movement)
        return Array.from(merged.values()).sort((a, b) => {
          const timeDifference = Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
          return timeDifference || b.id.localeCompare(a.id)
        })
      })
      setHasMoreMovements(page.length === 300)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'No fue posible cargar movimientos anteriores.')
    } finally {
      setLoadingOlderMovements(false)
    }
  }

  const saleForInvoice = invoiceMovement ? normalizeSaleSnapshot(invoiceMovement) : null

  return <div className="inventory-page">
    <div className="page-heading compact inventory-heading">
      <div>
        <p className="eyebrow">OPERACIÓN · CONTROL REAL</p>
        <h1>Inventario</h1>
        <p className="muted">Ingredientes, productos y recetas del restaurante.</p>
      </div>
      <div className="inventory-heading-actions">
        <div className="inventory-notification-wrap">
          <button className={`inventory-notification-trigger ${notificationsOpen ? 'open' : ''}`} type="button" aria-label="Notificaciones de inventario" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(open => !open)}>
            <Bell size={18}/>{inventoryNotifications.length > 0 && <span className="inventory-notification-count">{inventoryNotifications.length > 99 ? '99+' : inventoryNotifications.length}</span>}
          </button>
          {notificationsOpen && <div className="inventory-notification-panel" role="dialog" aria-label="Notificaciones">
            <div className="inventory-notification-head"><div><b>Notificaciones</b><span>{inventoryNotifications.length ? `${inventoryNotifications.length} alerta(s) activa(s)` : 'Todo al día'}</span></div><button type="button" className="inventory-icon-btn" aria-label="Cerrar notificaciones" onClick={() => setNotificationsOpen(false)}><X size={15}/></button></div>
            {inventoryNotifications.length === 0 ? <div className="inventory-notification-empty"><CheckCircle2 size={20}/><b>Sin alertas de stock</b><span>Cuando una existencia llegue al mínimo que configuraste, aparecerá aquí.</span></div> : <div className="inventory-notification-list">{inventoryNotifications.map(notification => <button type="button" className="inventory-notification-item" key={notification.id} onClick={() => { setSearch(notification.title); setShowArchived(false); setActiveTab(notification.recordKind === 'catalog_product' ? 'products' : 'stock'); setNotificationsOpen(false) }}><span className="inventory-notification-dot"/><span className="inventory-notification-copy"><b>{notification.title}</b><small>{notification.description}</small></span><ChevronDown size={14}/></button>)}</div>}
          </div>}
        </div>
        <button className="primary" onClick={openCreateItem} disabled={loading || !navigator.onLine}><Plus size={17}/> Agregar al inventario</button>
      </div>
    </div>

    {pageError && <div className="inventory-alert error"><ShieldAlert size={17}/><span>{pageError}</span><button onClick={() => setPageError('')} aria-label="Cerrar"><X size={16}/></button></div>}
    {feedback && !pageError && <div className="inventory-alert success"><Check size={17}/><span>{feedback}</span><button onClick={() => setFeedback('')} aria-label="Cerrar"><X size={16}/></button></div>}

    <div className="inventory-stats">
      <div className="inventory-stat"><span>Ingredientes activos</span><div><Boxes size={18}/></div><strong>{activeItems.length}</strong><small>Los que el restaurante decidió controlar</small></div>
      <div className="inventory-stat"><span>Existencias bajas</span><div><SlidersHorizontal size={18}/></div><strong className={lowCount ? 'inventory-number-warn' : ''}>{lowCount}</strong><small>Incluye faltantes y mínimos alcanzados</small></div>
      <div className="inventory-stat"><span>Stock negativo</span><div><ArrowDownLeft size={18}/></div><strong className={negativeCount ? 'inventory-number-danger' : ''}>{negativeCount}</strong><small>Faltantes visibles, nunca ocultos</small></div>
      <div className="inventory-stat"><span>Movimientos de hoy</span><div><CalendarClock size={18}/></div><strong>{movementsToday}</strong><small>Entradas, salidas y consumos</small></div>
    </div>

    <div className="inventory-tabs" role="tablist" aria-label="Secciones de inventario">
      <button className={activeTab === 'stock' ? 'active' : ''} onClick={() => setActiveTab('stock')}><Boxes size={16}/> Existencias <span>{activeItems.length}</span></button>
      <button className={activeTab === 'products' ? 'active' : ''} onClick={() => setActiveTab('products')}><Package size={16}/> Productos <span>{activeCatalogItems.length}</span></button>
      <button className={activeTab === 'recipes' ? 'active' : ''} onClick={() => setActiveTab('recipes')}><Utensils size={16}/> Consumo por producto <span>{recipeCountByProduct.size}</span></button>
      <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}><History size={16}/> Movimientos <span>{snapshot.movements.length}</span></button>
      <button className="inventory-refresh" onClick={() => void refresh()} disabled={loading} title="Actualizar inventario"><RefreshCw size={15} className={loading ? 'spin' : ''}/><span>Actualizar</span></button>
    </div>

    {activeTab === 'stock' && <>
      <div className="inventory-toolbar panel">
        <label className="inventory-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar ingrediente…" /></label>
        <label className="inventory-archived-toggle"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)}/><span>Ver archivados</span></label>
      </div>
      {loading ? <div className="inventory-empty panel"><RefreshCw className="spin" size={24}/><b>Cargando existencias</b><span>Un momento, estamos preparando las existencias.</span></div>
        : filteredItems.length === 0 ? <div className="inventory-empty panel"><div className="inventory-empty-icon"><PackagePlus size={28}/></div><h2>{showArchived ? 'No hay ingredientes archivados' : ingredientItems.length ? 'No encontramos ingredientes' : 'Tu inventario está virgen'}</h2><p>{showArchived ? 'Los ingredientes archivados aparecerán aquí.' : 'Empieza con lo que realmente utilizas. No hay ingredientes fijos ni obligatorios: tú decides qué controlar.'}</p>{!showArchived && <button className="primary" onClick={openCreateItem}><Plus size={16}/> Agregar ingrediente</button>}</div>
        : <div className="inventory-item-grid">{filteredItems.map(item => {
          const tone = itemTone(item)
          const amount = itemDisplayStock(item)
          const minimum = itemDisplayMinimum(item)
          const itemRecipeCount = snapshot.recipes.filter(recipe => recipe.inventoryItemId === item.id).length
          const hasRecipeAssociation = itemRecipeCount > 0
          return <article
            className={`inventory-item-card ${tone} ${hasRecipeAssociation ? 'recipe-linked' : 'recipe-unlinked'} ${!item.active ? 'archived' : ''}`}
            key={item.id}
            title={hasRecipeAssociation ? 'Ingrediente asociado a una o más recetas' : 'Ingrediente sin asociación a recetas'}
          >
            <div className="inventory-item-card-top"><div className="inventory-item-symbol"><Boxes size={20}/></div><div className="inventory-item-card-actions"><button className="inventory-icon-btn" title="Editar ingrediente" onClick={() => openEditItem(item)}><Pencil size={15}/></button><button className="inventory-icon-btn" title={item.active ? 'Archivar ingrediente' : 'Reactivar ingrediente'} onClick={() => void archiveItem(item)}><Archive size={15}/></button></div></div>
            <div className="inventory-item-name">{item.name}</div><div className="inventory-item-subtitle">{item.unit}</div>
            <div className="inventory-stock-line"><strong>{formatQuantity(amount)}</strong><span>{item.unit}</span></div>
            <div className={`inventory-stock-status ${tone}`}>{tone === 'negative' ? 'Existencia negativa' : tone === 'low' ? 'Existencias bajas' : item.active ? 'Stock registrado' : 'Archivado'}</div>
            {minimum !== null && <div className="inventory-minimum">Mínimo configurado: {formatQuantity(minimum)} {item.unit}</div>}
            {item.note && <p className="inventory-item-note">{item.note}</p>}
            <div className="inventory-item-footer"><span>{itemRecipeCount ? `${itemRecipeCount} receta(s)` : 'Sin recetas asociadas'}</span><button onClick={() => { setHistoryItemId(item.id); setActiveTab('history') }}><History size={14}/> Historial</button></div>
            {item.active && <div className="inventory-item-controls"><button onClick={() => openMovement(item,'entry')} disabled={!navigator.onLine}><Plus size={15}/> Entrada</button><button onClick={() => openMovement(item,'exit')} disabled={!navigator.onLine}><ArrowDownLeft size={15}/> Salida</button></div>}
          </article>
        })}</div>}
    </>}

    {activeTab === 'products' && <>
      <div className="inventory-toolbar panel">
        <label className="inventory-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar producto del catálogo…" /></label>
      </div>
      {loading ? <div className="inventory-empty panel"><RefreshCw className="spin" size={24}/><b>Cargando productos</b></div>
        : filteredCatalogItems.length === 0
          ? <div className="inventory-empty panel"><div className="inventory-empty-icon"><Package size={27}/></div><h2>{activeCatalogItems.length ? 'No encontramos productos' : 'Sin productos controlados'}</h2><p>Vincula un producto que ya exista en el catálogo para contar cuántas unidades llegaron y descontarlas al vender.</p><button className="primary" onClick={openCreateItem} disabled={!navigator.onLine}><Plus size={16}/> Agregar producto del catálogo</button></div>
          : <div className="inventory-item-grid inventory-catalog-stock-grid">{filteredCatalogItems.map(item => {
            const tone = itemTone(item)
            const amount = itemDisplayStock(item)
            const minimum = itemDisplayMinimum(item)
            const catalogProduct = products.find(product => product.id === item.catalogProductId)
            return <article className={`inventory-item-card inventory-catalog-product-card ${tone}`} key={item.id}>
              <div className="inventory-item-card-top"><div className="inventory-item-symbol"><Package size={20}/></div><div className="inventory-item-card-actions"><button className="inventory-icon-btn" title="Configurar alerta de stock" onClick={() => openEditItem(item)}><Pencil size={15}/></button><span className="inventory-catalog-pill">Producto de venta</span></div></div>
              <div className="inventory-item-name">{catalogProduct?.name || item.name}</div><div className="inventory-item-subtitle">{catalogProduct?.category || 'Catálogo'} · unidad</div>
              <div className="inventory-stock-line"><strong>{formatQuantity(amount)}</strong><span>unidad(es)</span></div>
              <div className={`inventory-stock-status ${tone}`}>{tone === 'negative' ? 'Existencia negativa' : tone === 'low' ? 'Existencias bajas' : 'Control de unidades activo'}</div>
              {minimum !== null && <div className="inventory-minimum">Alertar cuando llegue a {formatQuantity(minimum)} unidad(es)</div>}
              <div className="inventory-item-footer"><span>Se descuenta al vender</span><button type="button" onClick={() => { setHistoryItemId(item.id); setActiveTab('history') }}><History size={14}/> Historial</button></div>
              <div className="inventory-item-controls inventory-catalog-controls"><button onClick={() => openMovement(item,'entry')} disabled={!navigator.onLine || saving}><Plus size={15}/> Registrar llegada</button></div>
            </article>
          })}</div>}
    </>}

    {activeTab === 'recipes' && <>
      <section className="inventory-recipes-shell" aria-label="Recetas y consumo por producto">
        <div className="inventory-recipes-hero">
          <div className="inventory-recipes-hero-copy">
            <div className="inventory-recipes-hero-icon"><Utensils size={21}/></div>
            <div><span className="inventory-recipes-eyebrow">INVENTARIO · RECETAS</span><h2>Consumo por producto</h2><p>Define qué descuenta cada venta. Tú decides qué productos llevan receta.</p></div>
          </div>
          <div className="inventory-recipes-kpis" aria-label="Estado de las recetas">
            <div className="inventory-recipes-kpi is-ready"><CheckCircle2 size={16}/><strong>{recipeProducts.filter(product => (recipeCountByProduct.get(product.id) || 0) > 0).length}</strong><span>Configurados</span></div>
            <div className="inventory-recipes-kpi is-pending"><CircleDashed size={16}/><strong>{recipeProducts.filter(product => (recipeCountByProduct.get(product.id) || 0) === 0).length}</strong><span>Pendientes</span></div>
          </div>
        </div>

        {recipeProducts.length > 0 && <div className="inventory-recipes-toolbar">
          <label className="inventory-recipe-search"><Search size={17}/><input value={recipeSearch} onChange={event => setRecipeSearch(event.target.value)} placeholder="Buscar producto, combo o bebida…" aria-label="Buscar productos para configurar recetas"/><kbd>⌕</kbd></label>
          <div className="inventory-recipe-filters" role="group" aria-label="Filtrar productos por estado de receta">
            <button type="button" className={recipeFilter === 'all' ? 'active' : ''} onClick={() => setRecipeFilter('all')}>Todos <span>{recipeProducts.length}</span></button>
            <button type="button" className={recipeFilter === 'configured' ? 'active' : ''} onClick={() => setRecipeFilter('configured')}><CheckCircle2 size={13}/> Listos</button>
            <button type="button" className={recipeFilter === 'pending' ? 'active' : ''} onClick={() => setRecipeFilter('pending')}><CircleDashed size={13}/> Pendientes</button>
          </div>
        </div>}

        {recipeProducts.length === 0 ? <div className="inventory-empty panel"><Boxes size={25}/><h2>Aún no hay productos en el catálogo</h2><p>Agrega productos en Configuraciones → Productos. Aparecerán aquí para que puedas configurar sus recetas.</p></div> : (() => {
          const term = recipeSearch.trim().toLocaleLowerCase('es')
          const filteredProducts = recipeProducts.filter(product => {
            const count = recipeCountByProduct.get(product.id) || 0
            if (recipeFilter === 'configured' && count === 0) return false
            if (recipeFilter === 'pending' && count > 0) return false
            return !term || product.name.toLocaleLowerCase('es').includes(term) || (product.category || '').toLocaleLowerCase('es').includes(term)
          })
          return filteredProducts.length === 0
            ? <div className="inventory-recipes-no-results"><Search size={22}/><b>No encontramos productos</b><span>Prueba otra búsqueda o cambia el filtro.</span><button type="button" onClick={() => { setRecipeSearch(''); setRecipeFilter('all') }}>Limpiar filtros</button></div>
            : <div className="inventory-recipe-cards-grid">{filteredProducts.map(product => {
              const count = recipeCountByProduct.get(product.id) || 0
              const configured = count > 0
              return <button type="button" className={`inventory-recipe-card ${configured ? 'is-configured' : 'is-pending'}`} key={product.id} onClick={() => openRecipe(product)} aria-label={`${configured ? 'Editar receta de' : 'Configurar receta de'} ${product.name}`}>
                <div className="inventory-recipe-card-top"><div className="inventory-recipe-card-icon"><Utensils size={20}/></div><span className={`inventory-recipe-card-status ${configured ? 'configured' : 'pending'}`}>{configured ? <><CheckCircle2 size={13}/> Configurado</> : <><CircleDashed size={13}/> Por configurar</>}</span></div>
                <div className="inventory-recipe-card-main"><span className="inventory-recipe-card-category">{product.category || 'Sin categoría'}</span><h3>{product.name}</h3></div>
                <div className="inventory-recipe-card-bottom"><span>{configured ? `${count} ${count === 1 ? 'elemento vinculado' : 'elementos vinculados'}` : 'Aún no descuenta inventario'}</span><span className="inventory-recipe-card-cta">{configured ? 'Editar receta' : 'Crear receta'} <ArrowUpRight size={15}/></span></div>
              </button>
            })}</div>
        })()}
      </section>
      {activeItems.length === 0 && <div className="inventory-inline-note"><PackagePlus size={17}/><span>Primero agrega ingredientes en Existencias. Después podrás seleccionarlos en cada receta.</span><button onClick={() => { setActiveTab('stock'); openCreateItem() }}>Agregar ingrediente</button></div>}
    </>}

    {activeTab === 'history' && <>
      <div className="inventory-toolbar panel"><div className="inventory-history-description"><History size={18}/><div><b>Historial de movimientos</b><span>Consulta entradas, salidas y consumos de venta, con acceso a su factura.</span></div></div><select value={historyItemId} onChange={event => setHistoryItemId(event.target.value)} aria-label="Filtrar movimientos por existencia"><option value="all">Todos los registros</option>{snapshot.items.map(item => <option key={item.id} value={item.id}>{item.name}{item.removedAt ? ' (eliminado del inventario)' : item.active ? '' : ' (archivado)'}</option>)}</select></div>
      {filteredMovements.length === 0 ? <div className="inventory-empty panel"><History size={25}/><h2>Aún no hay movimientos</h2><p>Cuando registres entradas, salidas o vendas un producto con receta, la trazabilidad aparecerá aquí.</p></div>
        : <div className="panel inventory-movement-panel"><div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Fecha</th><th>Ingrediente</th><th>Movimiento</th><th>Cantidad</th><th>Saldo después</th><th>Motivo / origen</th><th>Usuario / factura</th></tr></thead><tbody>{filteredMovements.map(movement => {
          const item = snapshot.items.find(row => row.id === movement.inventoryItemId)
          const factor = item?.unitFactor || 1
          const stockAfter = toDisplayQuantity(movement.stockAfterBase, factor)
          const isSale = movement.movementType === 'sale_consumption' || movement.movementType === 'sale_reversal'
          return <tr key={movement.id}>
            <td><b>{date(movement.occurredAt)}</b><small>{time(movement.occurredAt)}</small></td>
            <td><b>{movement.itemName}</b>{movement.productName && <small>{movement.productName}{movement.soldProductQuantity ? ` · ${formatQuantity(movement.soldProductQuantity)} vendido(s)` : ''}</small>}</td>
            <td><span className={`inventory-movement-badge ${movement.movementType}`}>{movementLabel(movement)}</span></td>
            <td className={movement.displayQuantity < 0 ? 'movement-negative' : 'movement-positive'}>{movement.displayQuantity > 0 ? '+' : ''}{formatQuantity(movement.displayQuantity)} {movement.displayUnit}</td>
            <td><b className={stockAfter < 0 ? 'movement-negative' : ''}>{formatQuantity(stockAfter)} {item?.unit || movement.displayUnit}</b></td>
            <td>{movement.reason || '—'}</td>
            <td>{isSale ? <><b>{movement.actorName || 'Sistema'}</b><button className="inventory-invoice-link" onClick={() => startInvoice(movement)} disabled={!normalizeSaleSnapshot(movement)}><FileText size={14}/> Factura {movement.saleOrderNumber ? `#${movement.saleOrderNumber}` : `#${(movement.saleId || '').slice(-6).toUpperCase()}`}</button></> : <><b>{movement.actorName || 'Sistema'}</b><small>{movement.reason}</small></>}</td>
          </tr>
        })}</tbody></table></div><div className="inventory-table-footer">Mostrando {filteredMovements.length} movimientos.</div></div>}{hasMoreMovements && <div className="inventory-load-more"><button className="secondary" onClick={() => void loadOlderMovements()} disabled={loadingOlderMovements}>{loadingOlderMovements ? <><RefreshCw size={15} className="spin"/> Cargando movimientos…</> : <><History size={15}/> Cargar movimientos anteriores</>}</button><span>Consulta el historial completo, incluidos consumos y facturas anteriores.</span></div>}
    </>}

    {showEntryChoice && <div className="modal-backdrop inventory-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setShowEntryChoice(false) }}><div className="modal inventory-modal inventory-entry-choice-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-entry-choice-title"><div className="modal-header"><div><p className="eyebrow">NUEVO REGISTRO</p><h2 id="inventory-entry-choice-title">¿Qué quieres agregar?</h2><p className="muted">Elige cómo se controla en tu restaurante.</p></div><button className="inventory-icon-btn" onClick={() => setShowEntryChoice(false)} aria-label="Cerrar"><X size={18}/></button></div><div className="inventory-entry-choice-grid"><button type="button" onClick={openCreateIngredient}><span className="inventory-entry-choice-icon ingredient"><Boxes size={22}/></span><b>Ingrediente o insumo</b><small>Carne, pan, salsas y materiales que usan las recetas.</small><span className="inventory-entry-choice-action">Crear ingrediente <Plus size={15}/></span></button><button type="button" onClick={openLinkCatalogProduct} disabled={!availableCatalogProducts.length}><span className="inventory-entry-choice-icon product"><Package size={22}/></span><b>Producto del catálogo</b><small>Producto ya creado en Smaky; registra cuántas unidades llegaron.</small><span className="inventory-entry-choice-action">Vincular producto <Plus size={15}/></span>{!availableCatalogProducts.length && <em>Todos los productos activos ya están vinculados.</em>}</button></div></div></div>}

    {showCatalogProductForm && <div className="modal-backdrop inventory-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !saving) setShowCatalogProductForm(false); setLockedCatalogProductId(null) }}><div className="modal inventory-modal inventory-catalog-link-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-catalog-link-title"><div className="modal-header"><div><p className="eyebrow">PRODUCTO DE CATÁLOGO</p><h2 id="inventory-catalog-link-title">Controlar existencias de un producto</h2></div><button className="inventory-icon-btn" onClick={() => { if (!saving) { setShowCatalogProductForm(false); setLockedCatalogProductId(null) } }} aria-label="Cerrar"><X size={18}/></button></div><form onSubmit={saveCatalogProductLink}><label>Producto existente<select value={catalogProductForm.productId} onChange={event => setCatalogProductForm(current => ({ ...current, productId: event.target.value }))} disabled={Boolean(lockedCatalogProductId)} required><option value="">Seleccionar del catálogo…</option>{availableCatalogProducts.map(product => <option key={product.id} value={product.id}>{product.name} · {product.category}</option>)}</select>{lockedCatalogProductId && <small>Seleccionado desde el pedido que estás preparando.</small>}</label><label>Unidades que hay actualmente<input type="number" min="0" step="1" value={catalogProductForm.initialQuantity} onChange={event => setCatalogProductForm(current => ({ ...current, initialQuantity: event.target.value }))} required/></label><label>Notificar cuando queden (opcional)<input type="number" min="0" step="1" value={catalogProductForm.lowStockQuantity} onChange={event => setCatalogProductForm(current => ({ ...current, lowStockQuantity: event.target.value }))} placeholder="Sin alerta"/></label>{pageError && <p className="form-error">{pageError}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={() => { setShowCatalogProductForm(false); setLockedCatalogProductId(null) }} disabled={saving}>Cancelar</button><button type="submit" className="primary" disabled={saving || !navigator.onLine}>{saving ? 'Guardando…' : 'Agregar al inventario'}</button></div></form></div></div>}

    {showItemForm && <div className="modal-backdrop inventory-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !saving) setShowItemForm(false) }}><div className="modal inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-item-modal-title"><div className="modal-header"><div><p className="eyebrow">INVENTARIO CONFIGURABLE</p><h2 id="inventory-item-modal-title">{editingItem?.recordKind === 'catalog_product' ? 'Editar alerta del producto' : editingItem ? 'Editar ingrediente' : 'Agregar ingrediente o insumo'}</h2><p className="muted">{editingItem?.recordKind === 'catalog_product' ? editingItem.name : 'Registra solo los insumos que quieras controlar.'}</p></div><button className="inventory-icon-btn" onClick={() => !saving && setShowItemForm(false)} aria-label="Cerrar"><X size={18}/></button></div><form onSubmit={saveItem}>
      {editingItem?.recordKind !== 'catalog_product' && <label>Nombre del ingrediente o insumo<input value={itemForm.name} onChange={event => setItemForm({ ...itemForm, name: event.target.value })} placeholder="Ej. Carne artesanal" required autoFocus/></label>}
      {editingItem?.recordKind !== 'catalog_product' && <div className="form-row"><label>Unidad de medida<select value={itemForm.unit} onChange={event => setItemForm({ ...itemForm, unit: event.target.value })} disabled={Boolean(editingItem)} required>{itemUnitOptions.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select>{editingItem && <small>Se conserva para proteger las cantidades históricas.</small>}</label><label>Alertar cuando llegue a (opcional)<input type="number" min="0" step={unitMetadata(itemForm.unit).unitKind === 'custom' ? 1 : 0.001} value={itemForm.lowStockQuantity} onChange={event => setItemForm({ ...itemForm, lowStockQuantity: event.target.value })} placeholder="Sin alerta"/></label></div>}
      {editingItem?.recordKind === 'catalog_product' && <label>Alertar cuando queden (opcional)<input type="number" min="0" step="1" value={itemForm.lowStockQuantity} onChange={event => setItemForm({ ...itemForm, lowStockQuantity: event.target.value })} placeholder="Sin alerta"/></label>}
      {!editingItem && <label>Existencia inicial<input type="number" step={unitMetadata(itemForm.unit).unitKind === 'custom' ? 1 : 0.001} value={itemForm.initialQuantity} onChange={event => setItemForm({ ...itemForm, initialQuantity: event.target.value })} placeholder="0"/><small>Puedes iniciar en cero o en negativo si el conteo real ya tiene faltantes.</small></label>}
      {pageError && <p className="form-error">{pageError}</p>}<div className="modal-actions inventory-edit-actions">{editingItem && <button type="button" className="danger-inline-btn inventory-delete-entry-btn" onClick={() => void removeInventoryEntry()} disabled={saving || !navigator.onLine}><Trash2 size={15}/> {editingItem.recordKind === 'catalog_product' ? 'Quitar del inventario' : 'Eliminar del inventario'}</button>}<button type="button" className="secondary" onClick={() => setShowItemForm(false)} disabled={saving}>Cancelar</button><button type="submit" className="primary" disabled={saving}>{saving ? 'Guardando…' : <><Check size={15}/> {editingItem?.recordKind === 'catalog_product' ? 'Guardar alerta' : 'Guardar ingrediente'}</>}</button></div>
    </form></div></div>}

    {movementItem && <div className="modal-backdrop inventory-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !saving) setMovementItem(null) }}><div className="modal inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-movement-modal-title"><div className="modal-header"><div><p className="eyebrow">MOVIMIENTO DE EXISTENCIAS</p><h2 id="inventory-movement-modal-title">{movementForm.movementType === 'entry' ? 'Registrar entrada' : 'Registrar salida'}</h2><p className="muted">{movementItem.name} · saldo actual: {formatQuantity(itemDisplayStock(movementItem))} {movementItem.unit}</p></div><button className="inventory-icon-btn" onClick={() => !saving && setMovementItem(null)} aria-label="Cerrar"><X size={18}/></button></div><form onSubmit={saveMovement}>
      <div className="inventory-movement-type-selector"><button type="button" className={movementForm.movementType === 'entry' ? 'selected entry' : ''} onClick={() => setMovementForm({ ...movementForm, movementType: 'entry', reason: 'Compra / reposición' })}><ArrowUpRight size={17}/> Entrada (+)</button>{movementItem.recordKind !== 'catalog_product' && <button type="button" className={movementForm.movementType === 'exit' ? 'selected exit' : ''} onClick={() => setMovementForm({ ...movementForm, movementType: 'exit', reason: 'Merma / desperdicio' })}><ArrowDownLeft size={17}/> Salida (−)</button>}</div>
      <label>Cantidad ({movementItem.unit})<input type="number" min={movementItem.unitKind === 'custom' ? 1 : 0.001} step={movementItem.unitKind === 'custom' ? 1 : 0.001} value={movementForm.quantity} onChange={event => setMovementForm({ ...movementForm, quantity: event.target.value })} placeholder={movementItem.unitKind === 'custom' ? "Ej. 1, 2 o 3" : "Ej. 1 o 0,5"} required autoFocus/><small>{movementItem.unitKind === 'custom' ? "Cantidad entera: 1, 2, 3…" : "Puedes usar fracciones para peso o volumen."}</small></label>
      <label>Fecha y hora<input type="datetime-local" value={movementForm.occurredAt} onChange={event => setMovementForm({ ...movementForm, occurredAt: event.target.value })} required/></label>
      <label>Motivo<input list="inventory-movement-reasons" value={movementForm.reason} onChange={event => setMovementForm({ ...movementForm, reason: event.target.value })} placeholder="Ej. Compra, desperdicio, ajuste…" required/><datalist id="inventory-movement-reasons">{reasonsByType[movementForm.movementType].map(reason => <option key={reason} value={reason}/>)}</datalist></label>
      {pageError && <p className="form-error">{pageError}</p>}<div className="inventory-movement-preview"><span>Saldo después del movimiento</span><strong className={movementForm.movementType === 'exit' && Number(movementForm.quantity) > itemDisplayStock(movementItem) ? 'movement-negative' : ''}>{formatQuantity(itemDisplayStock(movementItem) + (movementForm.movementType === 'entry' ? 1 : -1) * (Number(movementForm.quantity) || 0))} {movementItem.unit}</strong></div>
      <div className="modal-actions"><button type="button" className="secondary" onClick={() => setMovementItem(null)} disabled={saving}>Cancelar</button><button type="submit" className="primary" disabled={saving || !navigator.onLine}>{saving ? 'Guardando…' : 'Registrar movimiento'}</button></div>
    </form></div></div>}

    {recipeProduct && <div className="modal-backdrop inventory-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !saving) setRecipeProduct(null) }}><div className="modal inventory-modal inventory-recipe-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-recipe-modal-title"><div className="modal-header"><div><p className="eyebrow">CONSUMO POR PRODUCTO</p><h2 id="inventory-recipe-modal-title">{recipeProduct.name}</h2><p className="muted">Configura qué descuenta cada venta.</p></div><button className="inventory-icon-btn" onClick={() => !saving && setRecipeProduct(null)} aria-label="Cerrar"><X size={18}/></button></div>
      <div className="inventory-recipe-editor-head"><div><b>Ingredientes</b></div><button className="secondary" disabled={!activeItems.length} onClick={() => setRecipeDraft(current => [...current, { inventoryItemId: '', quantity: '1', unit: '' }])}><Plus size={15}/> Añadir ingrediente</button></div>
      <div className="inventory-recipe-lines">{recipeDraft.length === 0 ? <div className="inventory-recipe-empty"><Utensils size={21}/><span>Sin ingredientes directos.</span>{activeItems.length > 0 && <button type="button" onClick={() => setRecipeDraft([{ inventoryItemId: '', quantity: '1', unit: '' }])}>Añadir ingrediente</button>}{!activeItems.length && <button type="button" onClick={() => { setRecipeProduct(null); setActiveTab('stock'); openCreateItem() }}>Crear ingrediente</button>}</div> : recipeDraft.map((row,index) => {
          const chosen = activeItems.find(item => item.id === row.inventoryItemId)
          const units = chosen ? recipeUnits(chosen).filter(unit => measurementUnits.some(configured => configured.toLocaleLowerCase('es') === unit.toLocaleLowerCase('es')) || unit.toLocaleLowerCase('es') === chosen.unit.toLocaleLowerCase('es')) : []
          return <div className="inventory-recipe-line" key={`${recipeProduct.id}-${index}`}><label className="inventory-recipe-ingredient"><span>Ingrediente</span><select value={row.inventoryItemId} onChange={event => { const nextItem = activeItems.find(item => item.id === event.target.value); updateRecipeRow(index,{ inventoryItemId: event.target.value, unit: nextItem?.unit || '' }) }}><option value="">Seleccionar ingrediente…</option>{activeItems.map(item => <option key={item.id} value={item.id}>{item.name} · {item.unit} · stock {formatQuantity(itemDisplayStock(item))}</option>)}</select></label><label className="inventory-recipe-quantity"><span>Cantidad</span><input type="number" min="0.001" step="0.001" value={row.quantity} onChange={event => updateRecipeRow(index,{quantity:event.target.value})}/></label><label className="inventory-recipe-unit"><span>Unidad de consumo</span><select value={row.unit} onChange={event => updateRecipeRow(index,{unit:event.target.value})} disabled={!chosen}><option value="">Unidad…</option>{units.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label><button type="button" className="inventory-remove-line" onClick={() => setRecipeDraft(current => current.filter((_,rowIndex) => rowIndex !== index))} title="Quitar ingrediente" aria-label="Quitar ingrediente"><Trash2 size={16}/></button></div>
        })}</div>

      <div className="inventory-recipe-editor-head inventory-recipe-components-head"><div><b>Productos incluidos <small>(opcional)</small></b></div><button className="secondary" disabled={recipeProducts.filter(product => product.id !== recipeProduct.id).length === 0} onClick={() => setRecipeComponentDraft(current => [...current, { componentProductId: '', quantity: '1' }])}><Plus size={15}/> Añadir producto</button></div>
      <div className="inventory-recipe-lines">{recipeComponentDraft.length === 0 ? <div className="inventory-recipe-empty"><Boxes size={21}/><span>Sin productos adicionales.</span>{recipeProducts.some(product => product.id !== recipeProduct.id) && <button type="button" onClick={() => setRecipeComponentDraft([{ componentProductId: '', quantity: '1' }])}>Añadir producto incluido</button>}</div> : recipeComponentDraft.map((row,index) => <div className="inventory-recipe-component-line" key={`${recipeProduct.id}-component-${index}`}><label><span>Producto incluido</span><select value={row.componentProductId} onChange={event => setRecipeComponentDraft(current => current.map((item,rowIndex) => rowIndex === index ? { ...item, componentProductId: event.target.value } : item))}><option value="">Seleccionar producto…</option>{recipeProducts.filter(product => product.id !== recipeProduct.id).map(product => <option key={product.id} value={product.id}>{product.name} · {product.category || 'Sin categoría'}</option>)}</select></label><label className="inventory-component-quantity"><span>Cantidad</span><input type="number" min="0.001" step="0.001" value={row.quantity} onChange={event => setRecipeComponentDraft(current => current.map((item,rowIndex) => rowIndex === index ? { ...item, quantity: event.target.value } : item))}/></label><button type="button" className="inventory-remove-line" onClick={() => setRecipeComponentDraft(current => current.filter((_,rowIndex) => rowIndex !== index))} title="Quitar producto incluido" aria-label="Quitar producto incluido"><Trash2 size={16}/></button></div>)}</div>
      <div className="inventory-recipe-note inventory-recipe-note-compact"><ArrowLeftRight size={15}/><span>Se descuenta al vender. Si falta stock, el saldo puede quedar negativo.</span></div>
      {pageError && <p className="form-error">{pageError}</p>}<div className="modal-actions"><button className="secondary" onClick={() => setRecipeProduct(null)} disabled={saving}>Cancelar</button><button className="primary" onClick={() => void saveRecipe()} disabled={saving}>{saving ? 'Guardando…' : <><Check size={15}/> Guardar receta</>}</button></div>
    </div></div>}

    {invoiceMovement && saleForInvoice && <div className="modal-backdrop inventory-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setInvoiceMovement(null) }}><div className="modal inventory-invoice-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-invoice-title"><div className="modal-header"><div><p className="eyebrow">TRAZABILIDAD DE INVENTARIO</p><h2 id="inventory-invoice-title">Factura de venta</h2><p className="muted">Este comprobante se conserva con el movimiento para poder rastrear el consumo.</p></div><button className="inventory-icon-btn" onClick={() => setInvoiceMovement(null)} aria-label="Cerrar"><X size={18}/></button></div>
      <div className="inventory-invoice-summary"><div><span>Pedido</span><b>#{saleForInvoice.orderNumber ?? saleForInvoice.id.slice(-6).toUpperCase()}</b></div><div><span>Fecha</span><b>{date(saleForInvoice.createdAt)} · {time(saleForInvoice.createdAt)}</b></div><div><span>Usuario</span><b>{saleForInvoice.userName || invoiceMovement.actorName}</b></div><div><span>Total</span><b>{money(saleForInvoice.total)}</b></div></div>
      <div className="inventory-invoice-items">{(saleForInvoice.items || []).map((saleItem,index) => <div key={saleItem.lineId || `${saleItem.productId}-${index}`}><span>{formatQuantity(saleItem.quantity)} × {saleItem.name}</span><b>{money(saleItem.total)}</b></div>)}</div>
      <div className="modal-actions"><button className="secondary" onClick={() => setInvoiceMovement(null)}>Cerrar</button><button className="primary" onClick={() => printSaleReceipt(saleForInvoice, 10)}><Printer size={15}/> Imprimir factura</button></div>
    </div></div>}
  </div>
}
