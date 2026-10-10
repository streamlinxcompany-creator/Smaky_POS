import {
  Archive, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Boxes, CalendarClock,
  Check, ChevronDown, ClipboardList, Clock3, FileText, History, PackagePlus,
  Pencil, Plus, Printer, RefreshCw, Search, ShieldAlert, SlidersHorizontal,
  Tag, Trash2, Utensils, WalletCards, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { getSessionUser, hasPermission } from '../lib/auth'
import { DEFAULT_INVENTORY_UNITS, getAllProducts, getInventoryUnits } from '../lib/store'
import { date, money, time } from '../lib/format'
import { printSaleReceipt } from '../lib/print'
import {
  adjustInventoryStock, createInventoryItem, formatQuantity, getInventoryMovementPage, getInventorySnapshot,
  recipeUnits, saveProductRecipe, setInventoryItemActive, subscribeInventoryChanges,
  toDisplayQuantity, updateInventoryItem,
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

export function Inventory() {
  const user = getSessionUser()
  const [snapshot, setSnapshot] = useState<InventorySnapshot>(emptySnapshot)
  const [products, setProducts] = useState<Product[]>([])
  const [measurementUnits, setMeasurementUnits] = useState<string[]>(DEFAULT_INVENTORY_UNITS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [activeTab, setActiveTab] = useState<'stock' | 'recipes' | 'history'>('stock')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
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
      setProducts(productRows.filter(product => product.active && !product.deletedAt))
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

  const categories = useMemo(() => Array.from(new Set(snapshot.items.map(item => item.category.trim()).filter(Boolean))).sort((a,b) => a.localeCompare(b,'es')), [snapshot.items])
  const activeItems = useMemo(() => snapshot.items.filter(item => item.active), [snapshot.items])
  const itemUnitOptions = useMemo(() => {
    const options = [...measurementUnits]
    if (editingItem?.unit && !options.some(unit => unit.toLocaleLowerCase('es') === editingItem.unit.toLocaleLowerCase('es'))) options.push(editingItem.unit)
    return options
  }, [measurementUnits, editingItem])
  const filteredItems = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es')
    return snapshot.items.filter(item => {
      if (!showArchived && !item.active) return false
      if (showArchived && item.active) return false
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
      return !term || item.name.toLocaleLowerCase('es').includes(term) || item.category.toLocaleLowerCase('es').includes(term)
    }).sort((a,b) => a.name.localeCompare(b.name,'es'))
  }, [snapshot.items, search, categoryFilter, showArchived])
  const recipeCountByProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const recipe of snapshot.recipes) map.set(recipe.productId, (map.get(recipe.productId) || 0) + 1)
    for (const component of snapshot.productComponents) map.set(component.productId, (map.get(component.productId) || 0) + 1)
    return map
  }, [snapshot.recipes, snapshot.productComponents])
  const lowCount = activeItems.filter(item => item.stockBase < 0 || (item.lowStockBase !== null && item.stockBase <= item.lowStockBase)).length
  const negativeCount = activeItems.filter(item => item.stockBase < 0).length
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
    setEditingItem(null)
    setItemForm({ name: '', category: '', unit: 'unidad', initialQuantity: '0', lowStockQuantity: '', note: '' })
    setPageError(''); setFeedback(''); setShowItemForm(true)
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
    if (!name) { setPageError('Escribe el nombre del ingrediente o insumo.'); return }
    if (!unit) { setPageError('Elige o escribe la unidad de medida.'); return }
    if (!Number.isFinite(initialQuantity)) { setPageError('La existencia inicial debe ser un número válido.'); return }
    if (low !== null && (!Number.isFinite(low) || low < 0)) { setPageError('El mínimo de existencias debe ser cero o mayor.'); return }
    setSaving(true); setPageError(''); setFeedback('')
    try {
      if (editingItem) {
        await updateInventoryItem(editingItem, { name, category: itemForm.category, lowStockQuantity: low, note: itemForm.note })
        setFeedback('Ingrediente actualizado y guardado en Supabase.')
      } else {
        await createInventoryItem({ id: crypto.randomUUID(), name, category: itemForm.category, unit, initialQuantity, lowStockQuantity: low, note: itemForm.note })
        setFeedback('Ingrediente creado y guardado en Supabase.')
      }
      setShowItemForm(false)
      await refresh(true)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'No fue posible guardar el ingrediente.')
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
    const quantity = Number(movementForm.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) { setPageError('La cantidad debe ser mayor que cero.'); return }
    if (!movementForm.reason.trim()) { setPageError('Escribe el motivo del movimiento.'); return }
    const occurredAt = new Date(movementForm.occurredAt).toISOString()
    setSaving(true); setPageError(''); setFeedback('')
    try {
      await adjustInventoryStock({ movementId: crypto.randomUUID(), itemId: movementItem.id, quantity, movementType: movementForm.movementType, reason: movementForm.reason, occurredAt })
      setMovementItem(null)
      setFeedback(`${movementForm.movementType === 'entry' ? 'Entrada' : 'Salida'} registrada. Existencias actualizadas en Supabase.`)
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
      setFeedback(rows.length || components.length ? `Receta de “${recipeProduct.name}” guardada en Supabase.` : `“${recipeProduct.name}” quedó sin consumo de inventario.`)
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
        <p className="muted">Existencias, recetas y trazabilidad, sincronizadas con Supabase.</p>
      </div>
      <div className="inventory-heading-actions">
        <span className={`inventory-online-pill ${navigator.onLine ? 'online' : 'offline'}`}><span/>{navigator.onLine ? 'Conectado a la base de datos' : 'Sin conexión'}</span>
        <button className="primary" onClick={openCreateItem} disabled={loading || !navigator.onLine}><Plus size={17}/> Agregar ingrediente</button>
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
      <button className={activeTab === 'recipes' ? 'active' : ''} onClick={() => setActiveTab('recipes')}><Utensils size={16}/> Consumo por producto <span>{recipeCountByProduct.size}</span></button>
      <button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}><History size={16}/> Movimientos <span>{snapshot.movements.length}</span></button>
      <button className="inventory-refresh" onClick={() => void refresh()} disabled={loading} title="Actualizar desde Supabase"><RefreshCw size={15} className={loading ? 'spin' : ''}/><span>Actualizar</span></button>
    </div>

    {activeTab === 'stock' && <>
      <div className="inventory-toolbar panel">
        <label className="inventory-search"><Search size={16}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar ingrediente o categoría…" /></label>
        <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)} aria-label="Filtrar por categoría"><option value="all">Todas las categorías</option>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select>
        <label className="inventory-archived-toggle"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)}/><span>Ver archivados</span></label>
      </div>
      {loading ? <div className="inventory-empty panel"><RefreshCw className="spin" size={24}/><b>Cargando existencias</b><span>Consultando la base de datos compartida…</span></div>
        : filteredItems.length === 0 ? <div className="inventory-empty panel"><div className="inventory-empty-icon"><PackagePlus size={28}/></div><h2>{showArchived ? 'No hay ingredientes archivados' : snapshot.items.length ? 'No encontramos ingredientes' : 'Tu inventario está virgen'}</h2><p>{showArchived ? 'Los ingredientes archivados aparecerán aquí.' : 'Empieza con lo que realmente utilizas. No hay ingredientes fijos ni obligatorios: tú decides qué controlar.'}</p>{!showArchived && <button className="primary" onClick={openCreateItem}><Plus size={16}/> Crear el primer ingrediente</button>}</div>
        : <div className="inventory-item-grid">{filteredItems.map(item => {
          const tone = itemTone(item)
          const amount = itemDisplayStock(item)
          const minimum = itemDisplayMinimum(item)
          const itemRecipeCount = snapshot.recipes.filter(recipe => recipe.inventoryItemId === item.id).length
          return <article className={`inventory-item-card ${tone} ${!item.active ? 'archived' : ''}`} key={item.id}>
            <div className="inventory-item-card-top"><div className="inventory-item-symbol"><Boxes size={20}/></div><div className="inventory-item-card-actions"><button className="inventory-icon-btn" title="Editar ingrediente" onClick={() => openEditItem(item)}><Pencil size={15}/></button><button className="inventory-icon-btn" title={item.active ? 'Archivar ingrediente' : 'Reactivar ingrediente'} onClick={() => void archiveItem(item)}><Archive size={15}/></button></div></div>
            <div className="inventory-item-name">{item.name}</div><div className="inventory-item-subtitle">{item.category || 'Sin categoría'} · {item.unit}</div>
            <div className="inventory-stock-line"><strong>{formatQuantity(amount)}</strong><span>{item.unit}</span></div>
            <div className={`inventory-stock-status ${tone}`}>{tone === 'negative' ? 'Existencia negativa' : tone === 'low' ? 'Existencias bajas' : item.active ? 'Stock registrado' : 'Archivado'}</div>
            {minimum !== null && <div className="inventory-minimum">Mínimo configurado: {formatQuantity(minimum)} {item.unit}</div>}
            {item.note && <p className="inventory-item-note">{item.note}</p>}
            <div className="inventory-item-footer"><span>{itemRecipeCount ? `${itemRecipeCount} receta(s)` : 'Sin recetas asociadas'}</span><button onClick={() => { setHistoryItemId(item.id); setActiveTab('history') }}><History size={14}/> Historial</button></div>
            {item.active && <div className="inventory-item-controls"><button onClick={() => openMovement(item,'entry')} disabled={!navigator.onLine}><Plus size={15}/> Entrada</button><button onClick={() => openMovement(item,'exit')} disabled={!navigator.onLine}><ArrowDownLeft size={15}/> Salida</button></div>}
          </article>
        })}</div>}
    </>}

    {activeTab === 'recipes' && <>
      <div className="inventory-section-intro"><div><h2>¿Qué consume cada producto?</h2><p>Elige una hamburguesa o combo y selecciona ingredientes del inventario. Si no configuras una receta, ese producto se vende sin descontar ingredientes.</p></div><span><Utensils size={16}/> Recetas opcionales</span></div>
      {products.length === 0 ? <div className="inventory-empty panel"><Boxes size={25}/><h2>Aún no hay productos en el catálogo</h2><p>Agrega productos en Configuraciones → Productos. Aparecerán aquí para que puedas configurar sus recetas.</p></div>
        : <div className="inventory-product-grid">{products.map(product => {
          const count = recipeCountByProduct.get(product.id) || 0
          return <button className="inventory-recipe-product" key={product.id} onClick={() => openRecipe(product)}><div className="inventory-product-icon"><Utensils size={22}/></div><div className="inventory-recipe-product-content"><b>{product.name}</b><span>{product.category || 'Sin categoría'}</span></div><div className="inventory-recipe-product-right"><span className={count ? 'configured' : 'unconfigured'}>{count ? `${count} elemento(s) configurado(s)` : 'Sin consumo configurado'}</span><ChevronDown size={16}/></div></button>
        })}</div>}
      {activeItems.length === 0 && <div className="inventory-inline-note"><PackagePlus size={17}/><span>Primero agrega ingredientes en Existencias. Después podrás seleccionarlos en cada receta.</span><button onClick={() => { setActiveTab('stock'); openCreateItem() }}>Agregar ingrediente</button></div>}
    </>}

    {activeTab === 'history' && <>
      <div className="inventory-toolbar panel"><div className="inventory-history-description"><History size={18}/><div><b>Historial de movimientos</b><span>Cada cambio de existencia conserva fecha, usuario, motivo y saldo antes/después.</span></div></div><select value={historyItemId} onChange={event => setHistoryItemId(event.target.value)} aria-label="Filtrar movimientos por ingrediente"><option value="all">Todos los ingredientes</option>{snapshot.items.map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (archivado)'}</option>)}</select></div>
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
        })}</tbody></table></div><div className="inventory-table-footer">Mostrando {filteredMovements.length} movimientos cargados desde Supabase.</div></div>}{hasMoreMovements && <div className="inventory-load-more"><button className="secondary" onClick={() => void loadOlderMovements()} disabled={loadingOlderMovements}>{loadingOlderMovements ? <><RefreshCw size={15} className="spin"/> Cargando movimientos…</> : <><History size={15}/> Cargar movimientos anteriores</>}</button><span>Consulta el historial completo, incluidos consumos y facturas anteriores.</span></div>}
    </>}

    {showItemForm && <div className="modal-backdrop inventory-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !saving) setShowItemForm(false) }}><div className="modal inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-item-modal-title"><div className="modal-header"><div><p className="eyebrow">INVENTARIO CONFIGURABLE</p><h2 id="inventory-item-modal-title">{editingItem ? 'Editar ingrediente' : 'Agregar ingrediente'}</h2><p className="muted">No hay ingredientes obligatorios. Registra solo lo que quieras controlar.</p></div><button className="inventory-icon-btn" onClick={() => !saving && setShowItemForm(false)} aria-label="Cerrar"><X size={18}/></button></div><form onSubmit={saveItem}>
      <label>Nombre del ingrediente o insumo<input value={itemForm.name} onChange={event => setItemForm({ ...itemForm, name: event.target.value })} placeholder="Ej. Carne artesanal" required autoFocus/></label>
      <div className="form-row"><label>Categoría (opcional)<input value={itemForm.category} onChange={event => setItemForm({ ...itemForm, category: event.target.value })} placeholder="Ej. Carnes"/></label><label>Unidad de medida<select value={itemForm.unit} onChange={event => setItemForm({ ...itemForm, unit: event.target.value })} disabled={Boolean(editingItem)} required>{itemUnitOptions.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select>{editingItem ? <small>La unidad se mantiene para proteger el historial de cantidades.</small> : <small>¿Necesitas otra? Agrégala en Configuraciones → Inventario.</small>}</label></div>
      {!editingItem && <label>Existencia inicial<input type="number" step="any" value={itemForm.initialQuantity} onChange={event => setItemForm({ ...itemForm, initialQuantity: event.target.value })} placeholder="0"/><small>Puedes iniciar en cero o en negativo si el conteo real ya tiene faltantes.</small></label>}
      <div className="form-row"><label>Alertar cuando llegue a (opcional)<input type="number" min="0" step="any" value={itemForm.lowStockQuantity} onChange={event => setItemForm({ ...itemForm, lowStockQuantity: event.target.value })} placeholder="Sin alerta"/></label><label>Nota (opcional)<input value={itemForm.note} onChange={event => setItemForm({ ...itemForm, note: event.target.value })} placeholder="Marca, tamaño, ubicación…"/></label></div>
      {pageError && <p className="form-error">{pageError}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={() => setShowItemForm(false)} disabled={saving}>Cancelar</button><button type="submit" className="primary" disabled={saving}>{saving ? 'Guardando…' : <><Check size={15}/> Guardar en Supabase</>}</button></div>
    </form></div></div>}

    {movementItem && <div className="modal-backdrop inventory-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !saving) setMovementItem(null) }}><div className="modal inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-movement-modal-title"><div className="modal-header"><div><p className="eyebrow">MOVIMIENTO DE EXISTENCIAS</p><h2 id="inventory-movement-modal-title">{movementForm.movementType === 'entry' ? 'Registrar entrada' : 'Registrar salida'}</h2><p className="muted">{movementItem.name} · saldo actual: {formatQuantity(itemDisplayStock(movementItem))} {movementItem.unit}</p></div><button className="inventory-icon-btn" onClick={() => !saving && setMovementItem(null)} aria-label="Cerrar"><X size={18}/></button></div><form onSubmit={saveMovement}>
      <div className="inventory-movement-type-selector"><button type="button" className={movementForm.movementType === 'entry' ? 'selected entry' : ''} onClick={() => setMovementForm({ ...movementForm, movementType: 'entry', reason: 'Compra / reposición' })}><ArrowUpRight size={17}/> Entrada (+)</button><button type="button" className={movementForm.movementType === 'exit' ? 'selected exit' : ''} onClick={() => setMovementForm({ ...movementForm, movementType: 'exit', reason: 'Merma / desperdicio' })}><ArrowDownLeft size={17}/> Salida (−)</button></div>
      <label>Cantidad ({movementItem.unit})<input type="number" min="0.000001" step="any" value={movementForm.quantity} onChange={event => setMovementForm({ ...movementForm, quantity: event.target.value })} placeholder="Ej. 10" required autoFocus/></label>
      <label>Fecha y hora<input type="datetime-local" value={movementForm.occurredAt} onChange={event => setMovementForm({ ...movementForm, occurredAt: event.target.value })} required/></label>
      <label>Motivo<input list="inventory-movement-reasons" value={movementForm.reason} onChange={event => setMovementForm({ ...movementForm, reason: event.target.value })} placeholder="Ej. Compra, desperdicio, ajuste…" required/><datalist id="inventory-movement-reasons">{reasonsByType[movementForm.movementType].map(reason => <option key={reason} value={reason}/>)}</datalist></label>
      {pageError && <p className="form-error">{pageError}</p>}<div className="inventory-movement-preview"><span>Saldo después del movimiento</span><strong className={movementForm.movementType === 'exit' && Number(movementForm.quantity) > itemDisplayStock(movementItem) ? 'movement-negative' : ''}>{formatQuantity(itemDisplayStock(movementItem) + (movementForm.movementType === 'entry' ? 1 : -1) * (Number(movementForm.quantity) || 0))} {movementItem.unit}</strong></div>
      <div className="modal-actions"><button type="button" className="secondary" onClick={() => setMovementItem(null)} disabled={saving}>Cancelar</button><button type="submit" className="primary" disabled={saving || !navigator.onLine}>{saving ? 'Guardando…' : 'Registrar movimiento'}</button></div>
    </form></div></div>}

    {recipeProduct && <div className="modal-backdrop inventory-modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !saving) setRecipeProduct(null) }}><div className="modal inventory-modal inventory-recipe-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-recipe-modal-title"><div className="modal-header"><div><p className="eyebrow">CONSUMO POR PRODUCTO</p><h2 id="inventory-recipe-modal-title">{recipeProduct.name}</h2><p className="muted">Configura qué descuenta cada venta.</p></div><button className="inventory-icon-btn" onClick={() => !saving && setRecipeProduct(null)} aria-label="Cerrar"><X size={18}/></button></div>
      <div className="inventory-recipe-editor-head"><div><b>Ingredientes</b></div><button className="secondary" disabled={!activeItems.length} onClick={() => setRecipeDraft(current => [...current, { inventoryItemId: '', quantity: '1', unit: '' }])}><Plus size={15}/> Añadir ingrediente</button></div>
      <div className="inventory-recipe-lines">{recipeDraft.length === 0 ? <div className="inventory-recipe-empty"><Utensils size={21}/><span>Sin ingredientes directos.</span>{activeItems.length > 0 && <button type="button" onClick={() => setRecipeDraft([{ inventoryItemId: '', quantity: '1', unit: '' }])}>Añadir ingrediente</button>}{!activeItems.length && <button type="button" onClick={() => { setRecipeProduct(null); setActiveTab('stock'); openCreateItem() }}>Crear ingrediente</button>}</div> : recipeDraft.map((row,index) => {
          const chosen = activeItems.find(item => item.id === row.inventoryItemId)
          const units = chosen ? recipeUnits(chosen) : []
          return <div className="inventory-recipe-line" key={`${recipeProduct.id}-${index}`}><label className="inventory-recipe-ingredient"><span>Ingrediente</span><select value={row.inventoryItemId} onChange={event => { const nextItem = activeItems.find(item => item.id === event.target.value); updateRecipeRow(index,{ inventoryItemId: event.target.value, unit: nextItem?.unit || '' }) }}><option value="">Seleccionar ingrediente…</option>{activeItems.map(item => <option key={item.id} value={item.id}>{item.name} · {item.unit} · stock {formatQuantity(itemDisplayStock(item))}</option>)}</select></label><label className="inventory-recipe-quantity"><span>Cantidad</span><input type="number" min="0.000001" step="any" value={row.quantity} onChange={event => updateRecipeRow(index,{quantity:event.target.value})}/></label><label className="inventory-recipe-unit"><span>Unidad de consumo</span><select value={row.unit} onChange={event => updateRecipeRow(index,{unit:event.target.value})} disabled={!chosen}><option value="">Unidad…</option>{units.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label><button type="button" className="inventory-remove-line" onClick={() => setRecipeDraft(current => current.filter((_,rowIndex) => rowIndex !== index))} title="Quitar ingrediente" aria-label="Quitar ingrediente"><Trash2 size={16}/></button></div>
        })}</div>

      <div className="inventory-recipe-editor-head inventory-recipe-components-head"><div><b>Productos incluidos <small>(opcional)</small></b></div><button className="secondary" disabled={products.filter(product => product.id !== recipeProduct.id).length === 0} onClick={() => setRecipeComponentDraft(current => [...current, { componentProductId: '', quantity: '1' }])}><Plus size={15}/> Añadir producto</button></div>
      <div className="inventory-recipe-lines">{recipeComponentDraft.length === 0 ? <div className="inventory-recipe-empty"><Boxes size={21}/><span>Sin productos adicionales.</span>{products.some(product => product.id !== recipeProduct.id) && <button type="button" onClick={() => setRecipeComponentDraft([{ componentProductId: '', quantity: '1' }])}>Añadir producto incluido</button>}</div> : recipeComponentDraft.map((row,index) => <div className="inventory-recipe-component-line" key={`${recipeProduct.id}-component-${index}`}><label><span>Producto incluido</span><select value={row.componentProductId} onChange={event => setRecipeComponentDraft(current => current.map((item,rowIndex) => rowIndex === index ? { ...item, componentProductId: event.target.value } : item))}><option value="">Seleccionar producto…</option>{products.filter(product => product.id !== recipeProduct.id).map(product => <option key={product.id} value={product.id}>{product.name} · {product.category || 'Sin categoría'}</option>)}</select></label><label className="inventory-component-quantity"><span>Cantidad</span><input type="number" min="0.000001" step="any" value={row.quantity} onChange={event => setRecipeComponentDraft(current => current.map((item,rowIndex) => rowIndex === index ? { ...item, quantity: event.target.value } : item))}/></label><button type="button" className="inventory-remove-line" onClick={() => setRecipeComponentDraft(current => current.filter((_,rowIndex) => rowIndex !== index))} title="Quitar producto incluido" aria-label="Quitar producto incluido"><Trash2 size={16}/></button></div>)}</div>
      <div className="inventory-recipe-note inventory-recipe-note-compact"><ArrowLeftRight size={15}/><span>Se descuenta al vender. Si falta stock, el saldo puede quedar negativo.</span></div>
      {pageError && <p className="form-error">{pageError}</p>}<div className="modal-actions"><button className="secondary" onClick={() => setRecipeProduct(null)} disabled={saving}>Cancelar</button><button className="primary" onClick={() => void saveRecipe()} disabled={saving}>{saving ? 'Guardando…' : <><Check size={15}/> Guardar receta en Supabase</>}</button></div>
    </div></div>}

    {invoiceMovement && saleForInvoice && <div className="modal-backdrop inventory-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setInvoiceMovement(null) }}><div className="modal inventory-invoice-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-invoice-title"><div className="modal-header"><div><p className="eyebrow">TRAZABILIDAD DE INVENTARIO</p><h2 id="inventory-invoice-title">Factura de venta</h2><p className="muted">Este comprobante se conserva con el movimiento para poder rastrear el consumo.</p></div><button className="inventory-icon-btn" onClick={() => setInvoiceMovement(null)} aria-label="Cerrar"><X size={18}/></button></div>
      <div className="inventory-invoice-summary"><div><span>Pedido</span><b>#{saleForInvoice.orderNumber ?? saleForInvoice.id.slice(-6).toUpperCase()}</b></div><div><span>Fecha</span><b>{date(saleForInvoice.createdAt)} · {time(saleForInvoice.createdAt)}</b></div><div><span>Usuario</span><b>{saleForInvoice.userName || invoiceMovement.actorName}</b></div><div><span>Total</span><b>{money(saleForInvoice.total)}</b></div></div>
      <div className="inventory-invoice-items">{(saleForInvoice.items || []).map((saleItem,index) => <div key={saleItem.lineId || `${saleItem.productId}-${index}`}><span>{formatQuantity(saleItem.quantity)} × {saleItem.name}</span><b>{money(saleItem.total)}</b></div>)}</div>
      <div className="modal-actions"><button className="secondary" onClick={() => setInvoiceMovement(null)}>Cerrar</button><button className="primary" onClick={() => printSaleReceipt(saleForInvoice, 10)}><Printer size={15}/> Imprimir factura</button></div>
    </div></div>}
    <div className="inventory-footnote"><Clock3 size={14}/> Los cambios se guardan directamente en Supabase. Los movimientos de venta se generan dentro de la misma transacción que registra el cobro.</div>
  </div>
}
