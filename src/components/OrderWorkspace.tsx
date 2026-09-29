import { Check, CreditCard, FileText, Minus, Plus, Printer, Search, ShoppingCart, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { completeOrder, createOrder, getProducts, getSaleForOrder, updateOrderItems } from '../lib/store'
import { money, time, date } from '../lib/format'
import type { Order, PaymentMethod, Product, SaleItem, User } from '../lib/types'
import { printOrderComanda, printSaleReceipt } from '../lib/print'

const categories = ['Todos', 'Hamburguesas', 'Combos', 'Acompañamientos', 'Bebidas'] as const
const modificationChips = ['Sin salsas', 'Sin tomate', 'Sin lechuga', 'Sin cebolla', 'Sin queso']

type Props = {
  user: User
  initialOrder?: Order | null
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

export function OrderWorkspace({ user, initialOrder, onClose, onOrderChange }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [items, setItems] = useState<SaleItem[]>(initialOrder?.items.map(item => ({ ...item, lineId: item.lineId || newLineId() })) || [])
  const [order, setOrder] = useState<Order | null>(initialOrder || null)
  const [category, setCategory] = useState<(typeof categories)[number]>('Todos')
  const [search, setSearch] = useState('')
  const [payment, setPayment] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState(initialOrder?.notes || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const isLocked = order?.status === 'paid' || order?.status === 'cancelled'
  const initialItems = order?.items || []
  const dirty = Boolean(order) && (!sameItems(items, initialItems) || notes !== (order?.notes || ''))
  const total = useMemo(() => items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0), [items])
  const units = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items])
  const filtered = products.filter(product => {
    const categoryMatch = category === 'Todos' || product.category === category
    const q = search.trim().toLowerCase()
    return categoryMatch && (!q || product.name.toLowerCase().includes(q))
  })

  useEffect(() => { void getProducts().then(setProducts) }, [])

  const setCurrent = (next: Order | null) => {
    setOrder(next)
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

  const printCurrentComanda = (target?: Window | null, currentOrder = order) => {
    if (!currentOrder) return false
    return printOrderComanda({ ...currentOrder, items, subtotal: total, total, notes }, target)
  }

  const saveDraft = async (print = true): Promise<Order | null> => {
    const printTarget = print ? window.open('', '_blank', 'width=460,height=760') : null
    setSaving(true)
    setError('')
    try {
      if (!items.length) throw new Error('Agrega al menos un producto para registrar el pedido.')
      if (!order) {
        const created = await createOrder(items, { customerName: '', phone: '', address: '', notes }, user)
        setCurrent(created)
        const printed = printOrderComanda(created, printTarget)
        if (print && !printed) setError('El pedido se registró, pero el navegador bloqueó la comanda. Permite las ventanas emergentes para Smaky.')
        else setMessage(`Pedido #${created.orderNumber} registrado`)
        return created
      }
      const updated = dirty ? await updateOrderItems(order.id, items, notes) : order
      if (!updated) return null
      setCurrent(updated)
      if (print) {
        const printed = printOrderComanda(updated, printTarget)
        if (!printed) setError('Los cambios se guardaron, pero el navegador bloqueó la comanda.')
        else setMessage('Cambios guardados y comanda actualizada')
      } else setMessage('Cambios guardados')
      return updated
    } catch (caught) {
      printTarget?.close()
      console.error('No fue posible guardar el pedido:', caught)
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar el pedido.')
      return null
    } finally { setSaving(false) }
  }

  const payNow = async () => {
    if (!order || order.status === 'paid' || saving || !items.length) return
    const printTarget = window.open('', '_blank', 'width=460,height=760')
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
      const result = await completeOrder(currentOrder.id, payment, user)
      if (!result) throw new Error('No fue posible registrar el pago.')
      setCurrent(result.order)
      printSaleReceipt(result.sale, printTarget)
      setMessage('Pago registrado · pedido cerrado')
    } catch (caught) {
      printTarget?.close()
      console.error('No fue posible cobrar el pedido:', caught)
      setError(caught instanceof Error ? caught.message : 'No fue posible registrar el pago.')
    } finally { setSaving(false) }
  }

  const printInvoice = async () => {
    if (!order || order.status !== 'paid') return
    setError('')
    const target = window.open('', '_blank', 'width=460,height=760')
    try {
      const sale = await getSaleForOrder(order.id)
      if (!sale) throw new Error('No se encontró el comprobante de este pedido.')
      printSaleReceipt(sale, target)
    } catch (caught) {
      target?.close()
      setError(caught instanceof Error ? caught.message : 'No se pudo imprimir el comprobante.')
    }
  }

  return <div className="modal-backdrop workspace-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="order-workspace" role="dialog" aria-modal="true">
      <header className="workspace-head">
        <div className="workspace-title">
          <button className="receipt-close" onClick={onClose} aria-label="Cerrar"><X size={18}/></button>
          <div>
            <p className="eyebrow">{order ? `PEDIDO ${order.orderNumber}` : 'NUEVO PEDIDO'}</p>
            <h2>{order ? 'Editar pedido' : 'Registrar pedido'}</h2>
            <span>{order ? `${date(order.createdAt)} · ${time(order.createdAt)} · ${order.userName}` : 'Agrega productos, ajusta cada hamburguesa y deja todo listo desde este panel.'}</span>
          </div>
        </div>
        <div className="workspace-head-meta">
          {order && <span className={`order-status status-${order.status}`}>{order.status === 'paid' ? 'Pagado' : order.status === 'cancelled' ? 'Cancelado' : 'Pedido abierto'}</span>}
          <span className="workspace-units"><ShoppingCart size={14}/>{units} productos</span>
        </div>
      </header>

      <div className="workspace-body">
        <section className="workspace-catalog">
          <div className="workspace-section-head"><div><b>Productos</b><span>Selecciona para agregar</span></div><label className="workspace-search"><Search size={15}/><input value={search} onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)} placeholder="Buscar producto…"/></label></div>
          <div className="category-tabs workspace-tabs">{categories.map(item => <button className={category === item ? 'selected' : ''} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
          <div className="workspace-product-grid">
            {filtered.map(product => <button className="workspace-product" key={product.id} disabled={isLocked} onClick={() => addProduct(product)}>
              <div className="workspace-product-icon">{product.category === 'Hamburguesas' ? '🍔' : product.category === 'Combos' ? '🍔🍟' : product.category === 'Bebidas' ? '🥤' : '🍟'}</div>
              <div><b>{product.name}</b><small>{product.category}</small><span>{money(product.price)}</span></div>
              <Plus size={16}/>
            </button>)}
            {!filtered.length && <div className="workspace-empty-products"><Search size={21}/><b>No hay productos</b><span>Prueba otra categoría o búsqueda.</span></div>}
          </div>
        </section>

        <aside className="workspace-summary">
          <div className="workspace-summary-head"><div><b>{order ? `Pedido #${order.orderNumber}` : 'Tu pedido'}</b><span>{units} unidades · {items.length} líneas</span></div><strong>{money(total)}</strong></div>

          <div className="workspace-lines">
            {!items.length && <div className="workspace-empty-cart"><ShoppingCart size={28}/><b>Agrega tu primer producto</b><span>Los detalles aparecerán aquí.</span></div>}
            {items.map(item => <div className="workspace-line" key={item.lineId || item.productId}>
              <div className="workspace-line-head">
                <div className="workspace-line-name"><b>{item.name}</b><small>{item.category || 'Producto'} · {money(item.unitPrice)} c/u</small></div>
                <strong>{money(item.quantity * item.unitPrice)}</strong>
              </div>
              <div className="workspace-line-controls">
                <div className="qty"><button disabled={isLocked} onClick={() => changeQty(item.lineId || item.productId, -1)}><Minus size={13}/></button><b>{item.quantity}</b><button disabled={isLocked} onClick={() => changeQty(item.lineId || item.productId, 1)}><Plus size={13}/></button></div>
                <button className="workspace-remove" disabled={isLocked} onClick={() => removeItem(item.lineId || item.productId)}><Trash2 size={14}/></button>
              </div>
              <textarea disabled={isLocked} value={item.modification || ''} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setModification(item.lineId || item.productId, event.target.value)} placeholder="Modificación: sin tomate, sin salsa…" rows={2}/>
              {!isLocked && <div className="mod-chips">{modificationChips.map(chip => <button key={chip} onClick={() => setModification(item.lineId || item.productId, appendModification(item.modification, chip))}>{chip}</button>)}</div>}
            </div>)}
          </div>

          <div className="workspace-note">
            <label>Observaciones del pedido</label>
            <textarea value={notes} disabled={isLocked} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setNotes(event.target.value)} placeholder="Ej. Llevar servilletas / recoger en mostrador…" rows={2}/>
          </div>

          <div className="workspace-total-row"><span>Total</span><strong>{money(total)}</strong></div>

          {!order && <div className="workspace-bottom-actions">
            <button className="secondary workspace-print" disabled={!items.length || saving} onClick={() => void saveDraft(true)}><Printer size={16}/> {saving ? 'Registrando…' : 'Registrar e imprimir comanda'}</button>
          </div>}

          {order && !isLocked && <>
            <div className="workspace-payment">
              <div className="workspace-payment-title"><div><b>Pago</b><span>Selecciona cómo te pagan</span></div><CreditCard size={17}/></div>
              <div className="payment-grid workspace-payment-grid">{([['cash', 'Efectivo'], ['transfer', 'Transferencia'], ['card', 'Tarjeta']] as const).map(([value, label]) => <button key={value} className={payment === value ? 'selected' : ''} onClick={() => setPayment(value)}>{label}</button>)}</div>
            </div>
            <div className="workspace-final-actions">
              <button className="secondary" disabled={saving} onClick={() => void saveDraft(true)}><Printer size={15}/>{saving ? 'Guardando…' : dirty ? 'Guardar cambios + imprimir' : 'Imprimir comanda'}</button>
              <button className="primary workspace-pay" disabled={saving || !items.length} onClick={() => void payNow()}><CreditCard size={16}/>{saving ? 'Procesando…' : dirty ? `Guardar y cobrar ${money(total)}` : `Cobrar ${money(total)}`}</button>
            </div>
          </>}

          {order?.status === 'paid' && <div className="workspace-paid"><div className="workspace-paid-icon"><Check size={18}/></div><div><b>Pedido pagado</b><span>Ya está cerrado y registrado en Ventas.</span></div><button className="secondary" onClick={() => void saveDraft(true)}><Printer size={15}/> Comanda</button><button className="secondary" onClick={() => void printInvoice()}><FileText size={15}/> Factura</button></div>}
          {message && <div className="workspace-success">{message}</div>}
          {error && <div className="workspace-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Cerrar">×</button></div>}
        </aside>
      </div>
    </section>
  </div>
}
