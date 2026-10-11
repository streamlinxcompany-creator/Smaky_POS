import { AlertTriangle, ArrowRight, Banknote, Calculator, Check, CreditCard, ExternalLink, FileText, Minus, PackagePlus, PackageX, Plus, Printer, Search, ShoppingCart, SlidersHorizontal, Tag, Trash2, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import { hasPermission } from '../lib/auth'
import { completeOrder, createOrder, getGeneralSettings, getOrderFields, getPaymentMethods, getProductCategories, getProducts, updateOrderComandaStatus, updateOrderItems } from '../lib/store'
import { money, time, date } from '../lib/format'
import type { Customer, Order, PaymentMethod, PaymentMethodConfig, Product, Sale, SaleItem, User } from '../lib/types'
import { printOrderComanda, printSaleReceipt } from '../lib/print'
import { checkInventorySaleShortages, getInventoryManagedProductIds, subscribeInventoryChanges, type InventoryShortage } from '../lib/inventory'

const modificationChips = ['Sin salsas', 'Sin tomate', 'Sin lechuga', 'Sin cebolla', 'Sin queso']
const fallbackPaymentLabel = (payment: PaymentMethod) => payment === 'cash' ? 'Efectivo' : payment === 'transfer' ? 'Transferencia' : payment === 'card' ? 'Tarjeta' : payment

type Props = {
  user: User
  initialOrder?: Order | null
  initialCustomer?: Customer | null
  onClose: () => void
  onOrderChange?: (order: Order) => void
}

const newLineId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`

const emptyItem = (product: Product): SaleItem => ({
  lineId: newLineId(),
  productId: product.id,
  name: product.name,
  category: product.category,
  quantity: 1,
  unitPrice: product.price,
  total: product.price
})

const appendModification = (current: string | undefined, value: string) => {
  const next = value.trim()
  if (!next) return current || ''
  const parts = (current || '').split(' · ').map(item => item.trim()).filter(Boolean)
  if (!parts.some(item => item.toLowerCase() === next.toLowerCase())) parts.push(next)
  return parts.join(' · ')
}

const sameItems = (a: SaleItem[], b: SaleItem[]) => JSON.stringify(a.map(normalizeItem)) === JSON.stringify(b.map(normalizeItem))
const normalizeItem = (item: SaleItem) => ({
  productId: item.productId,
  name: item.name,
  category: item.category || '',
  quantity: item.quantity,
  unitPrice: item.unitPrice,
  total: item.quantity * item.unitPrice,
  modification: item.modification?.trim() || ''
})

export function OrderWorkspace({ user, initialOrder, initialCustomer, onClose, onOrderChange }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>([])
  const [receiptFontSize, setReceiptFontSize] = useState(11)
  const [comandaFontSize, setComandaFontSize] = useState(11)
  const [receiptPaperWidth, setReceiptPaperWidth] = useState<58 | 80 | 88>(58)
  const [orderFields, setOrderFields] = useState<import('../lib/types').OrderFieldConfig[]>([])
  const [items, setItems] = useState<SaleItem[]>(initialOrder?.items.map(item => ({ ...item, lineId: item.lineId || newLineId() })) || [])
  const [order, setOrder] = useState<Order | null>(initialOrder || null)
  const [customer, setCustomer] = useState<Customer | null>(initialCustomer || null)
  const [category, setCategory] = useState<(typeof categories)[number]>('Todos')
  const [search, setSearch] = useState('')
  const [payment, setPayment] = useState<PaymentMethod>('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent')
  const [discountValue, setDiscountValue] = useState('')
  const [notes, setNotes] = useState(initialOrder?.notes || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const [paymentProgress, setPaymentProgress] = useState(0)
  const paymentProgressRef = useRef(0)
  const paymentSliderRef = useRef<HTMLDivElement | null>(null)
  const paymentDraggingRef = useRef(false)
  const paymentDragOffsetRef = useRef(0)
  const [completedSale, setCompletedSale] = useState<Sale | null>(null)
  const [paymentCountdown, setPaymentCountdown] = useState(0)
  const [inventoryWarning, setInventoryWarning] = useState<{ shortages: InventoryShortage[]; checkFailed?: string } | null>(null)
  const [inventoryManagedProductIds, setInventoryManagedProductIds] = useState<Set<string> | null>(null)
  const [inventoryBypassedProductIds, setInventoryBypassedProductIds] = useState<Set<string>>(new Set())
  const [inventoryPromptProduct, setInventoryPromptProduct] = useState<Product | null>(null)
  const [inventoryPromptError, setInventoryPromptError] = useState('')
  const [inventoryPromptCheckFailed, setInventoryPromptCheckFailed] = useState(false)
  const [inventorySetupOpened, setInventorySetupOpened] = useState(false)
  const inventorySetupProductRef = useRef<string | null>(null)
  const inventoryChecksInFlightRef = useRef<Set<string>>(new Set())

  const isLocked = order?.status === 'paid' || order?.status === 'cancelled'
  const initialItems = order?.items || []
  const dirty = Boolean(order) && (!sameItems(items, initialItems) || notes !== (order?.notes || ''))
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0), [items])
  const parsedDiscountValue = Number(discountValue || 0)
  const discountAmount = useMemo(() => {
    const safeValue = Number.isFinite(parsedDiscountValue) && parsedDiscountValue > 0 ? parsedDiscountValue : 0
    if (discountType === 'percent') return Math.min(subtotal, Math.round(subtotal * Math.min(100, safeValue) / 100))
    return Math.min(subtotal, Math.round(safeValue))
  }, [discountType, parsedDiscountValue, subtotal])
  const total = Math.max(0, subtotal - discountAmount)
  const cashReceivedNumber = Number(cashReceived || 0)
  const cashIsSufficient = payment !== 'cash' || (Number.isFinite(cashReceivedNumber) && cashReceivedNumber >= total)
  const cashChange = payment === 'cash' && Number.isFinite(cashReceivedNumber) ? Math.max(0, cashReceivedNumber - total) : 0
  const cashMissing = payment === 'cash' && Number.isFinite(cashReceivedNumber) ? Math.max(0, total - cashReceivedNumber) : 0
  const cashPresets = useMemo(() => {
    if (payment !== 'cash' || total <= 0) return []
    const values = [
      total,
      Math.ceil(total / 5000) * 5000,
      Math.ceil(total / 10000) * 10000,
      Math.ceil(total / 20000) * 20000,
    ]
    return Array.from(new Set(values.filter(value => value >= total))).slice(0, 4)
  }, [payment, total])
  const editingItem = editingLineId ? items.find(item => (item.lineId || item.productId) === editingLineId) || null : null
  const units = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items])
  const categoryTabs = useMemo(() => ['Todos', ...categories], [categories])
  const currentCustomer = customer || (order?.customerName ? {
    id: order.customerId || `legacy-${order.id}`,
    name: order.customerName,
    phone: order.phone,
    address: order.address,
    notes: order.notes,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    active: true
  } : null)

  const customerDelivery = currentCustomer ? {
    customerName: currentCustomer.name,
    phone: currentCustomer.phone,
    address: currentCustomer.address,
    notes: currentCustomer.notes,
    customFields: { ...(currentCustomer.customFields || {}) },
    customFieldLabels: Object.fromEntries(orderFields.filter(field => !field.system).map(field => [field.id, field.label]))
  } : { customerName: '', phone: '', address: '', notes: '', customFields: {}, customFieldLabels: {} }

  const filtered = products.filter(product => {
    const categoryMatch = category === 'Todos' || product.category === category
    const q = search.trim().toLowerCase()
    return categoryMatch && (!q || product.name.toLowerCase().includes(q))
  })

  useEffect(() => {
    const loadSharedConfiguration = () => {
      void Promise.all([getProducts(), getProductCategories(), getPaymentMethods(), getOrderFields(), getGeneralSettings()])
        .then(([productsData, categoryData, paymentMethodData, fieldData, settings]) => {
          setProducts(productsData)
          setCategories(categoryData)
          setPaymentMethods(paymentMethodData)
          setOrderFields(fieldData)
          setReceiptFontSize(settings.receiptFontSize)
          setComandaFontSize(settings.comandaFontSize || 11)
          setReceiptPaperWidth(settings.receiptPaperWidth || 58)
          if (paymentMethodData.length) setPayment(current => paymentMethodData.some(method => method.id === current) ? current : paymentMethodData[0].id)
        })
    }
    loadSharedConfiguration()
    const loadInventoryStatus = () => { void getInventoryManagedProductIds().then(setInventoryManagedProductIds).catch(() => setInventoryManagedProductIds(null)) }
    loadInventoryStatus()
    const unsubscribeInventory = subscribeInventoryChanges(loadInventoryStatus)
    window.addEventListener('smaky-settings-change', loadSharedConfiguration)
    return () => {
      unsubscribeInventory()
      window.removeEventListener('smaky-settings-change', loadSharedConfiguration)
    }
  }, [])

  useEffect(() => {
    if (payment !== 'cash') setCashReceived('')
    paymentProgressRef.current = 0
    setPaymentProgress(0)
  }, [payment])

  useEffect(() => {
    if (!cashIsSufficient) {
      paymentProgressRef.current = 0
      setPaymentProgress(0)
    }
  }, [cashIsSufficient])

  useEffect(() => {
    if (!completedSale) return
    const deadline = Date.now() + 5000
    setPaymentCountdown(5)
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setPaymentCountdown(remaining)
      if (remaining <= 0) {
        window.clearInterval(timer)
        onClose()
      }
    }, 100)
    return () => window.clearInterval(timer)
  }, [completedSale, onClose, onOrderChange])

  const setCurrent = (next: Order | null) => {
    setOrder(next)
    if (next?.customerName) setCustomer(current => current || { id: next.customerId || `legacy-${next.id}`, name: next.customerName, phone: next.phone, address: next.address, notes: next.notes, customFields: { ...(next.customFields || {}) }, createdAt: next.createdAt, updatedAt: next.updatedAt, active: true })
    if (next) {
      setItems(next.items.map(item => ({ ...item, lineId: item.lineId || newLineId() })))
      setNotes(next.notes || '')
      onOrderChange?.(next)
    }
  }

  const addProduct = (product: Product) => {
    if (isLocked) return
    setItems(current => {
      const existing = current.find(item => item.productId === product.id && !item.modification)
      if (existing) {
        const quantity = existing.quantity + 1
        return current.map(item => item.lineId === existing.lineId ? { ...item, quantity, total: quantity * item.unitPrice } : item)
      }
      return [...current, emptyItem(product)]
    })
    setMessage(`${product.name} agregado`)
    setTimeout(() => setMessage(''), 1400)
  }

  const handleProductSelection = async (product: Product) => {
    if (isLocked || saving || inventoryChecksInFlightRef.current.size > 0) return
    inventoryChecksInFlightRef.current.add(product.id)
    try {
      let managed = inventoryManagedProductIds
      if (!managed) {
        try {
          managed = await getInventoryManagedProductIds()
          setInventoryManagedProductIds(managed)
          setInventoryPromptError('')
        } catch (caught) {
          inventorySetupProductRef.current = product.id
          setInventoryPromptCheckFailed(true)
          setInventoryPromptError(caught instanceof Error ? caught.message : 'No fue posible consultar el inventario ahora.')
          setInventoryPromptProduct(product)
          setInventorySetupOpened(false)
          return
        }
      }
      if (managed.has(product.id) || inventoryBypassedProductIds.has(product.id)) {
        addProduct(product)
        return
      }
      inventorySetupProductRef.current = product.id
      setInventoryPromptCheckFailed(false)
      setInventorySetupOpened(false)
      setInventoryPromptError('')
      setInventoryPromptProduct(product)
    } finally {
      inventoryChecksInFlightRef.current.delete(product.id)
    }
  }

  const continueWithUntrackedProduct = () => {
    if (!inventoryPromptProduct) return
    const product = inventoryPromptProduct
    inventorySetupProductRef.current = null
    setInventoryBypassedProductIds(current => new Set([...current, product.id]))
    setInventoryPromptProduct(null)
    setInventoryPromptError('')
    setInventoryPromptCheckFailed(false)
    setInventorySetupOpened(false)
    addProduct(product)
  }

  const openInventoryForProduct = () => {
    if (!inventoryPromptProduct) return
    const product = inventoryPromptProduct
    if (!hasPermission(user, 'inventory.manage')) {
      setInventoryPromptError('Tu usuario no tiene permiso para administrar Inventario. Puedes continuar con la venta o solicitar acceso al gerente.')
      return
    }
    const target = new URL('/inventario', window.location.origin)
    target.searchParams.set('linkProductId', product.id)
    const opened = window.open(target.toString(), '_blank')
    if (!opened) {
      setInventoryPromptError('El navegador bloqueó la nueva pestaña. Permite ventanas emergentes para Smaky POS e inténtalo otra vez.')
      return
    }
    try { opened.opener = null } catch { /* optional browser hardening */ }
    setInventorySetupOpened(true)
    setInventoryPromptError('Inventario se abrió en otra pestaña con este producto seleccionado. Al guardar, este producto se agregará automáticamente al pedido que estás preparando.')
  }


  useEffect(() => {
    // When Inventory is opened in a second tab, successful product linking notifies this order draft.
    const acceptLinkedProduct = (productId: unknown) => {
      if (typeof productId !== 'string' || !productId || inventorySetupProductRef.current !== productId) return
      const product = products.find(row => row.id === productId)
      if (!product) return
      inventorySetupProductRef.current = null
      setInventoryManagedProductIds(current => new Set([...(current || []), productId]))
      setInventoryBypassedProductIds(current => { const next = new Set(current); next.delete(productId); return next })
      setInventoryPromptProduct(null)
      setInventoryPromptError('')
      setInventoryPromptCheckFailed(false)
      setInventorySetupOpened(false)
      addProduct(product)
      setMessage(`${product.name} agregado al pedido e inventario vinculado`)
      window.setTimeout(() => setMessage(''), 2200)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'smaky-inventory-catalog-linked' || !event.newValue) return
      try { const payload = JSON.parse(event.newValue) as { productId?: unknown }; acceptLinkedProduct(payload.productId) } catch { /* ignore malformed cross-tab signal */ }
    }
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('smaky-inventory-catalog-link') : null
    if (channel) channel.onmessage = event => acceptLinkedProduct((event.data as { productId?: unknown })?.productId)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener('storage', onStorage); channel?.close() }
  }, [products, isLocked, inventoryBypassedProductIds])
  const changeQty = (lineId: string | undefined, delta: number) => {
    if (isLocked) return
    setItems(current => current.flatMap(item => {
      if ((item.lineId || item.productId) !== (lineId || '')) return [item]
      const quantity = item.quantity + delta
      return quantity <= 0 ? [] : [{ ...item, quantity, total: quantity * item.unitPrice }]
    }))
  }

  const setModification = (lineId: string | undefined, value: string) => {
    if (isLocked) return
    setItems(current => current.map(item => (item.lineId || item.productId) === (lineId || '') ? { ...item, modification: value, total: item.quantity * item.unitPrice } : item))
  }

  const removeItem = (lineId: string | undefined) => {
    if (isLocked) return
    setItems(current => current.filter(item => (item.lineId || item.productId) !== (lineId || '')))
  }

  const selectDiscountPreset = (value: number) => {
    setDiscountValue(String(value))
  }

  const clearDiscount = () => {
    setDiscountValue('')
  }

  const saveDraft = async (print = true): Promise<Order | null> => {
    setSaving(true)
    setError('')
    try {
      if (!items.length) throw new Error('Agrega al menos un producto para registrar el pedido.')
      if (!order) {
        const created = await createOrder(items, { ...customerDelivery, notes: notes || customerDelivery.notes }, user, currentCustomer?.id)
        setCurrent(created)
        const printed = print ? printOrderComanda(created, comandaFontSize, receiptPaperWidth) : false
        if (printed) setCurrent(await updateOrderComandaStatus(created.id, 'printed'))
        if (print && !printed) setError('El pedido se registró, pero no fue posible iniciar la impresión automática.')
        else setMessage(print ? `Pedido #${created.orderNumber} registrado` : `Pedido #${created.orderNumber} guardado sin comanda`)
        return created
      }
      const updated = dirty ? await updateOrderItems(order.id, items, notes) : order
      if (!updated) return null
      setCurrent(updated)
      if (print) {
        const printed = printOrderComanda(updated, comandaFontSize, receiptPaperWidth)
        if (printed) setCurrent(await updateOrderComandaStatus(updated.id, 'printed'))
        if (!printed) setError('Los cambios se guardaron, pero no fue posible iniciar la impresión automática.')
        else setMessage('Cambios guardados y comanda actualizada')
      } else setMessage('Cambios guardados')
      return updated
    } catch (caught) {
      console.error('No fue posible guardar el pedido:', caught)
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar el pedido.')
      return null
    } finally { setSaving(false) }
  }

  const openCheckout = () => {
    if (!order || order.status === 'paid' || saving || !items.length) return
    paymentProgressRef.current = 0
    setPaymentProgress(0)
    setCashReceived('')
    setError('')
    setCheckoutOpen(true)
  }

  const updatePaymentSlide = (event: PointerEvent<HTMLDivElement>) => {
    if (saving || !paymentDraggingRef.current || !paymentSliderRef.current) return
    const bounds = paymentSliderRef.current.getBoundingClientRect()
    const thumbWidth = Math.min(48, Math.max(42, bounds.height - 14))
    const maxLeft = Math.max(1, bounds.width - thumbWidth - 14)
    const rawLeft = event.clientX - bounds.left - paymentDragOffsetRef.current
    const next = Math.max(0, Math.min(100, (rawLeft / maxLeft) * 100))
    paymentProgressRef.current = next
    setPaymentProgress(next)
  }

  const paymentSlideDown = (event: PointerEvent<HTMLDivElement>) => {
    if (saving || !cashIsSufficient) return
    const slider = paymentSliderRef.current
    if (!slider) return
    const thumb = event.currentTarget
    const thumbBounds = thumb.getBoundingClientRect()
    paymentDragOffsetRef.current = event.clientX - thumbBounds.left
    paymentDraggingRef.current = true
    thumb.setPointerCapture(event.pointerId)
  }

  const paymentSlideUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!paymentDraggingRef.current) return
    paymentDraggingRef.current = false
    try { event.currentTarget.releasePointerCapture(event.pointerId) } catch {}
    if (paymentProgressRef.current >= 96) void payNow()
    else {
      paymentProgressRef.current = 0
      setPaymentProgress(0)
    }
  }

  const payNow = async (continueDespiteInventoryWarning = false) => {
    if (!order || order.status === 'paid' || saving || !items.length || !cashIsSufficient || paymentProgressRef.current < 96) return

    // Check the authoritative stock on Supabase before finalizing the sale.
    // This check is advisory only: continuing always remains possible and the
    // database trigger will record the real resulting balance, including negatives.
    if (!continueDespiteInventoryWarning) {
      setSaving(true)
      setError('')
      try {
        const shortages = await checkInventorySaleShortages(items.map(item => ({ productId: item.productId, name: item.name, quantity: item.quantity })))
        if (shortages.length) {
          setInventoryWarning({ shortages })
          return
        }
      } catch (caught) {
        const checkMessage = caught instanceof Error ? caught.message : 'No fue posible consultar el inventario en este momento.'
        setInventoryWarning({ shortages: [], checkFailed: checkMessage })
        return
      } finally {
        setSaving(false)
      }
    }

    setInventoryWarning(null)
    setSaving(true)
    setError('')
    try {
      let currentOrder = order
      if (dirty) {
        const updated = await updateOrderItems(order.id, items, notes)
        if (!updated) throw new Error('No fue posible guardar los cambios antes de cobrar.')
        currentOrder = updated
        setCurrent(updated)
      }
      const discount = discountAmount > 0 ? { type: discountType, value: Number.isFinite(parsedDiscountValue) ? parsedDiscountValue : 0 } as const : undefined
      const selectedPayment = paymentMethods.find(method => method.id === payment)
      const result = await completeOrder(currentOrder.id, payment, user, discount, selectedPayment?.name || fallbackPaymentLabel(payment))
      if (!result) throw new Error('No fue posible registrar el pago.')
      setCurrent(result.order)
      setCheckoutOpen(false)
      paymentProgressRef.current = 0
      setPaymentProgress(0)
      setMessage('Venta realizada · factura enviada')
      const printed = printSaleReceipt(result.sale, receiptFontSize, 'ORIGINAL', receiptPaperWidth)
      if (!printed) setError('La venta quedó registrada, pero no fue posible iniciar la impresión automática de la factura.')
      setCompletedSale(result.sale)
    } catch (caught) {
      console.error('No fue posible cobrar el pedido:', caught)
      paymentProgressRef.current = 0
      setPaymentProgress(0)
      setError(caught instanceof Error ? caught.message : 'No fue posible registrar el pago.')
    } finally { setSaving(false) }
  }


  const exitCompletedSale = () => {
    setCompletedSale(null)
    setPaymentCountdown(0)
    onClose()
  }

  const requestClose = () => {
    if (saving || checkoutOpen) return
    if (!items.length && !order) return onClose()

    // If the current order version has already been printed and no editable
    // changes were made afterwards, closing should return to the orders list
    // directly. The warning is only for an unprinted/modified order.
    if (order?.comandaStatus === 'printed' && !dirty) return onClose()

    setClosePromptOpen(true)
  }

  const closeWithoutComanda = async () => {
    // Deliberadamente no usa saveDraft(): esta ruta nunca abre una ventana de impresión.
    setSaving(true)
    setError('')
    try {
      if (!items.length) throw new Error('Agrega al menos un producto para registrar el pedido.')
      const saved = !order
        ? await createOrder(items, { ...customerDelivery, notes: notes || customerDelivery.notes }, user, currentCustomer?.id)
        : dirty ? await updateOrderItems(order.id, items, notes) : order
      if (!saved) throw new Error('No fue posible guardar el pedido.')
      const marked = await updateOrderComandaStatus(saved.id, 'skipped')
      if (!marked) throw new Error('No fue posible marcar el pedido sin comanda.')
      setCurrent(marked)
      onOrderChange?.(marked)
      setMessage(`Pedido #${marked.orderNumber} guardado sin comanda`)
      setClosePromptOpen(false)
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar el pedido.')
    } finally { setSaving(false) }
  }

  const printAndClose = async () => {
    const saved = await saveDraft(true)
    if (!saved) return
    setClosePromptOpen(false)
    onClose()
  }


  return <div className="order-workspace-page">
    <section className="order-workspace" role="region" aria-label="Editor de pedido">
      <header className="workspace-head workspace-head-compact">
        <div className="workspace-title">
          <button className="receipt-close" onClick={requestClose} aria-label="Cerrar"><X size={18}/></button>
          <div>
            <p className="eyebrow">CUENTA ACTUAL</p>
            <h2>{order ? (currentCustomer ? `Pedido de ${currentCustomer.name}` : `Pedido #${order.orderNumber}`) : (currentCustomer ? `Pedido de ${currentCustomer.name}` : 'Nuevo pedido')}</h2>
            {order ? <span>{date(order.createdAt)} · {time(order.createdAt)} · {order.userName}</span> : currentCustomer ? <span>{currentCustomer.phone}{currentCustomer.address ? ` · ${currentCustomer.address}` : ''}</span> : <span>Sin cliente seleccionado</span>}
          </div>
        </div>
        <div className="workspace-head-meta">
          {order && <span className={`order-status status-${order.status}`}>{order.status === 'paid' ? 'Pagado' : order.status === 'cancelled' ? 'Cancelado' : 'Pedido abierto'}</span>}
          {order?.comandaStatus === 'skipped' && <span className="order-status status-cancelled">Sin comanda</span>}
          <span className="workspace-units"><ShoppingCart size={14}/>{units} unidades · {items.length} líneas</span>
        </div>
      </header>

      <div className="workspace-body">
        <section className="workspace-catalog">
          <div className="workspace-section-head"><div><b>Productos</b><span>Selecciona para agregar</span></div><label className="workspace-search"><Search size={15}/><input value={search} onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)} placeholder="Buscar producto…"/></label></div>
          <div className="category-tabs workspace-tabs">{categoryTabs.map(item => <button className={category === item ? 'selected' : ''} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
          <div className="workspace-product-grid">
            {filtered.map(product => <button className="workspace-product" key={product.id} disabled={isLocked} onClick={() => { void handleProductSelection(product) }}>
              <div className="workspace-product-icon">{product.category === 'Hamburguesas' ? '🍔' : product.category === 'Combos' ? '🍔🍟' : product.category === 'Bebidas' ? '🥤' : '🍟'}</div>
              <div><b>{product.name}</b><small>{product.category}</small><span>{money(product.price)}</span></div>
              <Plus size={16}/>
            </button>)}
            {!filtered.length && <div className="workspace-empty-products"><Search size={21}/><b>No hay productos</b><span>Prueba otra categoría o búsqueda.</span></div>}
          </div>
        </section>

        <aside className="workspace-summary">
          <div className="workspace-summary-head workspace-summary-head-compact">
            <div>
              <p className="workspace-summary-kicker">PEDIDO</p>
              {currentCustomer && <div className="workspace-customer-mini"><UserRound size={13}/><span>{currentCustomer.name}</span></div>}
              <b>{order ? `#${order.orderNumber}` : 'Tu pedido'}</b>
            </div>
            <div className="workspace-summary-total">
              <small>Total</small>
              <strong>{money(total)}</strong>
            </div>
          </div>

          <div className="workspace-lines">
            {!items.length && <div className="workspace-empty-cart"><ShoppingCart size={30}/><b>Agrega tu primer producto</b><span>Los productos y sus modificaciones aparecerán aquí.</span></div>}
            {items.map(item => {
              const lineId = item.lineId || item.productId
              return <article className={`workspace-line workspace-line-compact ${editingLineId === lineId ? 'selected' : ''}`} key={lineId} onClick={() => !isLocked && setEditingLineId(lineId)}>
                <div className="workspace-line-index"><span>{item.quantity}×</span></div>
                <div className="workspace-line-name"><b>{item.name}</b><small>{item.modification ? item.modification : item.category || 'Producto'}</small></div>
                <strong>{money(item.quantity * item.unitPrice)}</strong>
                <button className="workspace-edit" disabled={isLocked} onClick={(event) => { event.stopPropagation(); setEditingLineId(lineId) }} aria-label={`Modificar ${item.name}`}><SlidersHorizontal size={15}/></button>
                <button className="workspace-remove" disabled={isLocked} onClick={(event) => { event.stopPropagation(); removeItem(lineId) }} aria-label={`Eliminar ${item.name}`}><Trash2 size={15}/></button>
              </article>
            })}
          </div>

          <div className="workspace-total-row"><div><span>Total del pedido</span><small>{items.length} líneas · {units} unidades</small></div><strong>{money(total)}</strong></div>

          {!order && <div className="workspace-bottom-actions">
            <button className="secondary workspace-print" disabled={!items.length || saving} onClick={() => void saveDraft(true)}><Printer size={16}/> {saving ? 'Registrando…' : 'Registrar e imprimir comanda'}</button>
          </div>}

          {order && !isLocked && <>
            <div className="workspace-payment">
              <div className="workspace-payment-title"><div><b>Pago</b><span>Selecciona cómo te pagan</span></div><CreditCard size={17}/></div>
              <div className="payment-grid workspace-payment-grid">{paymentMethods.map(method => <button key={method.id} className={payment === method.id ? 'selected' : ''} onClick={() => setPayment(method.id)}>{method.name}</button>)}</div>
            </div>
            <div className="workspace-final-actions">
              <button className="secondary" disabled={saving} onClick={() => void saveDraft(true)}><Printer size={15}/>{saving ? 'Guardando…' : dirty ? 'Guardar cambios + imprimir' : 'Imprimir comanda'}</button>
              <button className="primary workspace-pay" disabled={saving || !items.length} onClick={openCheckout}><CreditCard size={16}/>{dirty ? `Guardar y cobrar ${money(total)}` : `Cobrar ${money(total)}`}</button>
            </div>
          </>}

          {message && <div className="workspace-success">{message}</div>}
          {error && <div className="workspace-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Cerrar">×</button></div>}
        </aside>
      </div>


      {checkoutOpen && <div className="item-editor-backdrop checkout-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) { setCheckoutOpen(false); setCashReceived(''); paymentProgressRef.current = 0; setPaymentProgress(0) } }}>
        <section className="item-editor-modal checkout-editor-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
          <header className="item-editor-head checkout-editor-head">
            <div>
              <span className="item-editor-kicker">VERIFICAR PAGO</span>
              <h3 id="checkout-title">Confirma el cobro</h3>
              <p>Revisa el pedido, el medio de pago y el total antes de registrar la venta.</p>
            </div>
            <button className="item-editor-close" disabled={saving} onClick={() => { setCheckoutOpen(false); setCashReceived(''); paymentProgressRef.current = 0; setPaymentProgress(0) }} aria-label="Cerrar"><X size={18}/></button>
          </header>

          <div className="item-editor-body checkout-editor-body">
            <div className="checkout-editor-layout">
              <div className="checkout-editor-column checkout-editor-left">
                <div className="checkout-summary-card checkout-module-card">
                  <div className="checkout-module-heading">
                    <div className="checkout-module-icon"><ShoppingCart size={17}/></div>
                    <div><span>MÓDULO 01</span><b>Pedido</b></div>
                    <strong>#{order?.orderNumber}</strong>
                  </div>
                  <div className="checkout-summary-card-head"><div><span>Productos</span><b>{items.length} líneas · {units} unidades</b></div></div>
                  <div className="checkout-customer-strip">
                    <div><span>Cliente</span><b>{currentCustomer?.name || 'Consumidor final'}</b></div>
                    {currentCustomer?.phone && <div><span>Teléfono</span><b>{currentCustomer.phone}</b></div>}
                  </div>
                  <div className="confirm-order-list">
                    {items.map(item => <div className="confirm-order-item" key={item.lineId || item.productId}>
                      <div><b>{item.quantity}× {item.name}</b><span>{item.modification || item.category || 'Producto'}</span></div>
                      <strong>{money(item.quantity * item.unitPrice)}</strong>
                    </div>)}
                  </div>
                </div>

                <div className="item-editor-section checkout-payment-section checkout-module-card">
                  <div className="checkout-module-heading">
                    <div className="checkout-module-icon"><CreditCard size={17}/></div>
                    <div><span>MÓDULO 02</span><b>Medios de pago</b></div>
                  </div>
                  <div className="item-editor-section-head"><div><b>¿Cómo paga el cliente?</b><span>Selecciona un solo medio de pago</span></div><strong>{paymentMethods.find(method => method.id === payment)?.name || fallbackPaymentLabel(payment)}</strong></div>
                  <div className="payment-grid checkout-payment-grid">{paymentMethods.map(method => <button key={method.id} className={payment === method.id ? 'selected' : ''} disabled={saving} onClick={() => setPayment(method.id)} aria-pressed={payment === method.id}>{method.name}</button>)}</div>
                </div>

                <div className={`checkout-cash-card checkout-module-card ${payment !== 'cash' ? 'checkout-cash-not-needed' : ''}`}>
                  <div className="checkout-module-heading">
                    <div className="checkout-module-icon"><Banknote size={17}/></div>
                    <div><span>MÓDULO 03</span><b>Arqueo de efectivo</b></div>
                    {payment === 'cash' && <span className={`checkout-module-status ${cashIsSufficient ? 'ok' : 'wait'}`}>{cashIsSufficient ? 'LISTO' : 'PENDIENTE'}</span>}
                  </div>
                  {payment === 'cash' ? <>
                    <p className="checkout-module-description">Registra cuánto efectivo recibes y calcula el cambio automáticamente.</p>
                    <label className="checkout-cash-field">
                      <span>EFECTIVO RECIBIDO</span>
                      <div className="checkout-cash-input-wrap"><span>$</span><input autoComplete="off" inputMode="decimal" type="number" min="0" step="100" value={cashReceived} onChange={event => setCashReceived(event.target.value)} placeholder={String(total)} disabled={saving}/></div>
                    </label>
                    <div className="checkout-cash-presets">{cashPresets.map(value => <button key={value} type="button" disabled={saving} onClick={() => setCashReceived(String(value))}>{value === total ? 'Exacto' : money(value)}</button>)}</div>
                    <div className={`checkout-change-box ${cashIsSufficient ? 'ready' : 'insufficient'}`}>
                      <div><span>Total a pagar</span><strong>{money(total)}</strong></div>
                      <Calculator size={18}/>
                      <div className="checkout-change-result"><span>{cashIsSufficient ? 'Devolver' : 'Faltante'}</span><strong>{money(cashIsSufficient ? cashChange : cashMissing)}</strong></div>
                    </div>
                    {!cashIsSufficient && <small className="checkout-cash-hint">Recibe al menos {money(total)} para poder confirmar el cobro.</small>}
                  </> : <div className="checkout-cash-no-required"><CreditCard size={21}/><div><b>No se requiere arqueo</b><span>El medio seleccionado es {paymentMethods.find(method => method.id === payment)?.name || fallbackPaymentLabel(payment)}. Puedes completar el cobro sin ingresar efectivo.</span></div></div>}
                </div>
              </div>

              <div className="checkout-editor-column checkout-editor-right">
                <div className="discount-editor checkout-discount-module">
                  <div className="checkout-module-heading">
                    <div className="checkout-module-icon"><Tag size={17}/></div>
                    <div><span>MÓDULO 04</span><b>Aplicar descuento</b></div>
                    <span className="checkout-module-status optional">{discountAmount > 0 ? 'APLICADO' : 'OPCIONAL'}</span>
                  </div>
                  <p className="checkout-module-description">Elige un porcentaje o un valor fijo. El total se actualiza automáticamente.</p>
                  <div className="checkout-discount-total">
                    <div><span>Total a cobrar</span><strong>{money(total)}</strong></div>
                    <small>{discountAmount > 0 ? `Subtotal ${money(subtotal)} · Descuento −${money(discountAmount)}` : `Subtotal sin descuento ${money(subtotal)}`}</small>
                  </div>
                  <div className="discount-type-switch"><button type="button" className={discountType === 'percent' ? 'selected' : ''} onClick={() => { setDiscountType('percent'); setDiscountValue('') }}>Porcentaje</button><button type="button" className={discountType === 'fixed' ? 'selected' : ''} onClick={() => { setDiscountType('fixed'); setDiscountValue('') }}>Valor fijo</button></div>
                  <label className="discount-input"><span>{discountType === 'percent' ? 'PORCENTAJE' : 'VALOR DEL DESCUENTO'}</span><div><input inputMode="decimal" type="number" min="0" max={discountType === 'percent' ? 100 : subtotal} step="1" value={discountValue} onChange={event => setDiscountValue(event.target.value)} placeholder={discountType === 'percent' ? '10' : '5000'} disabled={saving}/><b>{discountType === 'percent' ? '%' : '$'}</b></div></label>
                  <div className="discount-presets">{(discountType === 'percent' ? [5, 10, 15, 20] : [1000, 2000, 5000, 10000]).filter(value => value <= (discountType === 'percent' ? 100 : subtotal)).map(value => <button type="button" key={value} disabled={saving} onClick={() => selectDiscountPreset(value)}>{discountType === 'percent' ? `${value}%` : money(value)}</button>)}</div>
                  {discountAmount > 0 && <button type="button" className="discount-remove" disabled={saving} onClick={clearDiscount}>Quitar descuento</button>}
                  {dirty && <small className="checkout-discount-pending">Los cambios pendientes se guardarán antes de cobrar.</small>}
                </div>
              </div>
            </div>
            <div className="checkout-slider-section">
              <div className="checkout-slider-head"><div><b>Desliza para confirmar</b><span>{cashIsSufficient ? 'El pago solo se registra al llegar hasta el final.' : 'Completa el efectivo recibido para habilitar la confirmación.'}</span></div><span className={paymentProgress >= 96 && cashIsSufficient ? 'checkout-slider-ready' : ''}>{paymentProgress >= 96 && cashIsSufficient ? 'LISTO' : 'VERIFICACIÓN'}</span></div>
              <div ref={paymentSliderRef} className={`confirm-slider ${paymentProgress >= 96 && cashIsSufficient ? 'ready' : ''} ${!cashIsSufficient ? 'blocked' : ''}`}>
                <div className="confirm-slider-fill" style={{ width: `${Math.max(0, paymentProgress)}%` }} />
                <div className="confirm-slider-text">{saving ? 'Procesando pago…' : !cashIsSufficient ? 'Ingresa el efectivo recibido' : paymentProgress >= 96 ? 'Suelta para confirmar' : 'Arrastra el botón →'}</div>
                <button type="button" className="confirm-slider-thumb" style={{ left: `${Math.min(100, Math.max(0, paymentProgress))}%`, transform: `translateX(-${Math.min(100, Math.max(0, paymentProgress))}%)` }} onPointerDown={paymentSlideDown} onPointerMove={updatePaymentSlide} onPointerUp={paymentSlideUp} onPointerCancel={paymentSlideUp} disabled={saving || !cashIsSufficient} aria-label="Deslizar para confirmar el pago"><ArrowRight size={19}/></button>
              </div>
            </div>
            {error && <div className="workspace-error checkout-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Cerrar">×</button></div>}
          </div>

          <footer className="item-editor-footer checkout-editor-footer">
            <button className="secondary" disabled={saving} onClick={() => { setCheckoutOpen(false); setCashReceived(''); paymentProgressRef.current = 0; setPaymentProgress(0) }}>Cancelar</button>
            <div className="checkout-footer-total"><span>Total</span><strong>{money(total)}</strong></div>
          </footer>
        </section>
      </div>}

      {inventoryPromptProduct && <div className="item-editor-backdrop inventory-untracked-product-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) { inventorySetupProductRef.current = null; setInventoryPromptProduct(null); setInventoryPromptError(''); setInventoryPromptCheckFailed(false); setInventorySetupOpened(false) } }}>
        <section className="item-editor-modal inventory-untracked-product-modal" role="alertdialog" aria-modal="true" aria-labelledby="inventory-untracked-product-title">
          <header className="item-editor-head">
            <div className="inventory-untracked-product-icon"><PackagePlus size={23}/></div>
            <div><span className="item-editor-kicker">CONTROL DE INVENTARIO</span><h3 id="inventory-untracked-product-title">{inventoryPromptCheckFailed ? 'No pudimos verificar el inventario' : 'Producto sin inventario'}</h3><p>{inventoryPromptCheckFailed ? <>No pudimos confirmar si <b>{inventoryPromptProduct.name}</b> tiene control de stock. Puedes abrir Inventario para revisarlo o continuar con el pedido.</> : <><b>{inventoryPromptProduct.name}</b> todavía no está asociado a existencias ni a una receta de consumo. Puedes registrarlo ahora o continuar sin control de stock.</>}</p></div>
            <button className="item-editor-close" disabled={saving} onClick={() => { inventorySetupProductRef.current = null; setInventoryPromptProduct(null); setInventoryPromptError(''); setInventoryPromptCheckFailed(false); setInventorySetupOpened(false) }} aria-label="Cerrar"><X size={18}/></button>
          </header>
          <div className="item-editor-body inventory-untracked-product-body">
            {inventoryPromptError && <div className="inventory-shortage-check-error"><PackageX size={18}/><span>{inventoryPromptError}</span></div>}
            <div className="inventory-untracked-product-choice"><span className="inventory-untracked-choice-symbol"><PackagePlus size={20}/></span><div><b>Agregar al inventario</b><small>Abre Inventario en otra pestaña, con {inventoryPromptProduct.name} ya seleccionado. Solo tendrás que completar las existencias iniciales y la alerta opcional.</small></div><ExternalLink size={16}/></div>
          </div>
          <footer className="item-editor-footer inventory-untracked-product-actions"><button className="secondary" disabled={saving} onClick={continueWithUntrackedProduct}>Continuar sin inventario</button>{hasPermission(user, 'inventory.manage') && <button className="primary" disabled={saving} onClick={openInventoryForProduct}>{inventorySetupOpened ? 'Volver a abrir Inventario' : 'Agregar al inventario'} <ExternalLink size={15}/></button>}</footer>
        </section>
      </div>}

      {inventoryWarning && <div className="item-editor-backdrop inventory-shortage-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) { setInventoryWarning(null); paymentProgressRef.current = 0; setPaymentProgress(0) } }}>
        <section className="item-editor-modal inventory-shortage-modal" role="alertdialog" aria-modal="true" aria-labelledby="inventory-shortage-title">
          <header className="item-editor-head">
            <div className="inventory-shortage-icon"><AlertTriangle size={23}/></div>
            <div><span className="item-editor-kicker">CONTROL DE EXISTENCIAS</span><h3 id="inventory-shortage-title">{inventoryWarning.checkFailed ? 'No pudimos verificar el inventario' : 'Faltan ingredientes para este pedido'}</h3><p>{inventoryWarning.checkFailed ? 'La venta no se bloqueará. Puedes cancelar para intentarlo de nuevo o continuar; cuando se sincronice, el inventario reflejará el consumo real.' : 'Las existencias actuales no alcanzan para cubrir la receta configurada. Puedes continuar con la venta; los saldos quedarán en negativo si es necesario.'}</p></div>
            <button className="item-editor-close" disabled={saving} onClick={() => { setInventoryWarning(null); paymentProgressRef.current = 0; setPaymentProgress(0) }} aria-label="Cerrar"><X size={18}/></button>
          </header>
          <div className="item-editor-body inventory-shortage-body">
            {inventoryWarning.checkFailed ? <div className="inventory-shortage-check-error"><PackageX size={19}/><span>{inventoryWarning.checkFailed}</span></div> : <div className="inventory-shortage-list">
              {inventoryWarning.shortages.map(shortage => <div className="inventory-shortage-row" key={shortage.inventoryItemId}>
                <div><b>{shortage.itemName}</b><span>Necesario: {shortage.requiredQuantity.toLocaleString('es-CO', { maximumFractionDigits: 3 })} {shortage.unit}</span></div>
                <div className="inventory-shortage-values"><span>Disponible</span><strong className="inventory-shortage-available">{shortage.availableQuantity.toLocaleString('es-CO', { maximumFractionDigits: 3 })} {shortage.unit}</strong><small>Faltan {shortage.shortageQuantity.toLocaleString('es-CO', { maximumFractionDigits: 3 })} {shortage.unit}</small></div>
              </div>)}
            </div>}
            <div className="inventory-shortage-assurance"><Check size={16}/><span>La venta puede continuar. No se cambiarán las cantidades para esconder el faltante: Supabase registrará el saldo real incluso si queda negativo.</span></div>
          </div>
          <footer className="item-editor-footer inventory-shortage-actions"><button className="secondary" disabled={saving} onClick={() => { setInventoryWarning(null); paymentProgressRef.current = 0; setPaymentProgress(0) }}>Cancelar venta</button><button className="primary" disabled={saving} onClick={() => { setInventoryWarning(null); void payNow(true) }}>{saving ? 'Procesando…' : 'Continuar con la venta'}</button></footer>
        </section>
      </div>}

      {completedSale && <div className="payment-complete-overlay" role="status" aria-live="polite">
        <div className="payment-complete-topline" aria-hidden="true"><i style={{ width: `${((5 - paymentCountdown) / 5) * 100}%` }}/></div>
        <div className="payment-complete-card">
          <div className="payment-complete-check"><Check size={24}/></div>
          <span className="payment-complete-kicker">VENTA COMPLETADA</span>
          <h3>Factura enviada a impresión</h3>
          <p>Pedido <b>#{completedSale.orderNumber}</b> registrado correctamente.</p>
          <div className="payment-complete-total"><span>Total cobrado</span><strong>{money(completedSale.total)}</strong></div>
          <div className="payment-complete-actions"><button type="button" className="secondary payment-complete-exit" onClick={exitCompletedSale}><X size={14}/> Salir</button><div className="payment-complete-bottom"><span>Regresando a pedidos</span><b>{paymentCountdown}s</b></div></div>
        </div>
      </div>}

      {editingItem && <div className="item-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingLineId(null) }}>
        <section className="item-editor-modal" role="dialog" aria-modal="true" aria-label={`Modificar ${editingItem.name}`}>
          <header className="item-editor-head">
            <div>
              <span className="item-editor-kicker">MODIFICAR PRODUCTO</span>
              <h3>{editingItem.name}</h3>
              <p>{editingItem.category || 'Producto'} · {money(editingItem.unitPrice)} c/u</p>
            </div>
            <button className="item-editor-close" onClick={() => setEditingLineId(null)} aria-label="Cerrar"><X size={18}/></button>
          </header>

          <div className="item-editor-body">
            <div className="item-editor-section">
              <div className="item-editor-section-head"><div><b>Cantidad</b><span>Cuántas unidades quieres en esta línea</span></div><strong>{money(editingItem.quantity * editingItem.unitPrice)}</strong></div>
              <div className="item-editor-qty"><button disabled={isLocked} onClick={() => changeQty(editingItem.lineId || editingItem.productId, -1)}><Minus size={17}/></button><b>{editingItem.quantity}</b><button disabled={isLocked} onClick={() => changeQty(editingItem.lineId || editingItem.productId, 1)}><Plus size={17}/></button></div>
            </div>

            <div className="item-editor-section">
              <div className="item-editor-section-head"><div><b>Personalización</b><span>Indica exactamente qué debe cambiar</span></div>{editingItem.modification && <em>PERSONALIZADO</em>}</div>
              <textarea disabled={isLocked} value={editingItem.modification || ''} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setModification(editingItem.lineId || editingItem.productId, event.target.value)} placeholder="Ej. Sin tomate, sin salsa, extra queso…" rows={4}/>
              {!isLocked && <div className="mod-chips item-editor-chips">{modificationChips.map(chip => <button key={chip} onClick={() => setModification(editingItem.lineId || editingItem.productId, appendModification(editingItem.modification, chip))}>{chip}</button>)}</div>}
            </div>

            <div className="item-editor-preview">
              <div><span>En la cuenta</span><b>{editingItem.quantity}× {editingItem.name}</b>{editingItem.modification && <small>{editingItem.modification}</small>}</div>
              <strong>{money(editingItem.quantity * editingItem.unitPrice)}</strong>
            </div>
          </div>

          <footer className="item-editor-footer">
            <button className="secondary" onClick={() => setEditingLineId(null)}>Cerrar</button>
            <button className="primary" onClick={() => setEditingLineId(null)}>Guardar cambios</button>
          </footer>
        </section>
      </div>}
      {closePromptOpen && <div className="item-editor-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setClosePromptOpen(false) }}>
        <section className="item-editor-modal" role="dialog" aria-modal="true" aria-labelledby="close-order-title">
          <header className="item-editor-head"><div><span className="item-editor-kicker">PEDIDO SIN COMANDA</span><h3 id="close-order-title">¿Quieres salir sin imprimir comanda?</h3><p>El pedido se guardará y seguirá disponible para cobrar. Si eliges salir, aparecerá marcado como <b>Sin comanda</b>.</p></div><button className="item-editor-close" disabled={saving} onClick={() => setClosePromptOpen(false)} aria-label="Cerrar"><X size={18}/></button></header>
          <div className="item-editor-body"><div className="checkout-summary-card"><div className="checkout-summary-card-head"><div><span>Productos</span><b>{items.length} líneas · {units} unidades</b></div><div><span>Total</span><b>{money(total)}</b></div></div></div></div>
          <footer className="item-editor-footer"><button className="secondary" disabled={saving} onClick={() => setClosePromptOpen(false)}>Seguir editando</button><button className="secondary" disabled={saving} onClick={() => void closeWithoutComanda()}>Salir sin comanda</button><button className="primary" disabled={saving} onClick={() => void printAndClose()}><Printer size={15}/>{saving ? 'Guardando…' : 'Imprimir comanda y salir'}</button></footer>
        </section>
      </div>}
    </section>
  </div>
}
