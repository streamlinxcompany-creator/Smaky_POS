import { ArrowRight, Check, CreditCard, FileText, Minus, Plus, Printer, Search, ShoppingCart, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import { completeOrder, createOrder, getProducts, getSaleForOrder, updateOrderComandaStatus, updateOrderItems } from '../lib/store'
import { money, time, date } from '../lib/format'
import type { Order, PaymentMethod, Product, SaleItem, User } from '../lib/types'
import { printOrderComanda, printSaleReceipt } from '../lib/print'

const categories = ['Todos', 'Hamburguesas', 'Combos', 'Acompañamientos', 'Bebidas'] as const
const modificationChips = ['Sin salsas', 'Sin tomate', 'Sin lechuga', 'Sin cebolla', 'Sin queso']
const paymentLabel = (payment: PaymentMethod) => payment === 'cash' ? 'Efectivo' : payment === 'transfer' ? 'Transferencia' : 'Tarjeta'

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
  const [editingLineId, setEditingLineId] = useState<string | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const [paymentProgress, setPaymentProgress] = useState(0)
  const paymentProgressRef = useRef(0)
  const paymentSliderRef = useRef<HTMLDivElement | null>(null)
  const paymentDraggingRef = useRef(false)
  const paymentDragOffsetRef = useRef(0)

  const isLocked = order?.status === 'paid' || order?.status === 'cancelled'
  const initialItems = order?.items || []
  const dirty = Boolean(order) && (!sameItems(items, initialItems) || notes !== (order?.notes || ''))
  const total = useMemo(() => items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0), [items])
  const editingItem = editingLineId ? items.find(item => (item.lineId || item.productId) === editingLineId) || null : null
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

  const saveDraft = async (print = true): Promise<Order | null> => {
    const printTarget = print ? window.open('', '_blank', 'width=460,height=760') : null
    setSaving(true)
    setError('')
    try {
      if (!items.length) throw new Error('Agrega al menos un producto para registrar el pedido.')
      if (!order) {
        const created = await createOrder(items, { customerName: '', phone: '', address: '', notes }, user)
        setCurrent(created)
        const printed = print ? printOrderComanda(created, printTarget) : false
        if (printed) setCurrent(await updateOrderComandaStatus(created.id, 'printed'))
        if (print && !printed) setError('El pedido se registró, pero el navegador bloqueó la comanda. Permite las ventanas emergentes para Smaky.')
        else setMessage(print ? `Pedido #${created.orderNumber} registrado` : `Pedido #${created.orderNumber} guardado sin comanda`)
        return created
      }
      const updated = dirty ? await updateOrderItems(order.id, items, notes) : order
      if (!updated) return null
      setCurrent(updated)
      if (print) {
        const printed = printOrderComanda(updated, printTarget)
        if (printed) setCurrent(await updateOrderComandaStatus(updated.id, 'printed'))
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

  const openCheckout = () => {
    if (!order || order.status === 'paid' || saving || !items.length) return
    paymentProgressRef.current = 0
    setPaymentProgress(0)
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
    if (saving) return
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

  const payNow = async () => {
    if (!order || order.status === 'paid' || saving || !items.length || paymentProgressRef.current < 96) return
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
      setCheckoutOpen(false)
      paymentProgressRef.current = 0
      setPaymentProgress(0)
      setMessage('Venta realizada')
    } catch (caught) {
      console.error('No fue posible cobrar el pedido:', caught)
      paymentProgressRef.current = 0
      setPaymentProgress(0)
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

  const requestClose = () => {
    if (saving || checkoutOpen) return
    if (!items.length && !order) return onClose()
    setClosePromptOpen(true)
  }

  const closeWithoutComanda = async () => {
    // Deliberadamente no usa saveDraft(): esta ruta nunca abre una ventana de impresión.
    setSaving(true)
    setError('')
    try {
      if (!items.length) throw new Error('Agrega al menos un producto para registrar el pedido.')
      const saved = !order
        ? await createOrder(items, { customerName: '', phone: '', address: '', notes }, user)
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
            <h2>{order ? `Pedido #${order.orderNumber}` : 'Nuevo pedido'}</h2>
            {order && <span>{date(order.createdAt)} · {time(order.createdAt)} · {order.userName}</span>}
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
          <div className="workspace-summary-head workspace-summary-head-compact">
            <div>
              <p className="workspace-summary-kicker">PEDIDO</p>
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
              <div className="payment-grid workspace-payment-grid">{([['cash', 'Efectivo'], ['transfer', 'Transferencia'], ['card', 'Tarjeta']] as const).map(([value, label]) => <button key={value} className={payment === value ? 'selected' : ''} onClick={() => setPayment(value)}>{label}</button>)}</div>
            </div>
            <div className="workspace-final-actions">
              <button className="secondary" disabled={saving} onClick={() => void saveDraft(true)}><Printer size={15}/>{saving ? 'Guardando…' : dirty ? 'Guardar cambios + imprimir' : 'Imprimir comanda'}</button>
              <button className="primary workspace-pay" disabled={saving || !items.length} onClick={openCheckout}><CreditCard size={16}/>{dirty ? `Guardar y cobrar ${money(total)}` : `Cobrar ${money(total)}`}</button>
            </div>
          </>}

          {order?.status === 'paid' && <div className="workspace-paid"><div className="workspace-paid-icon"><Check size={18}/></div><div><b>Pedido pagado</b><span>Ya está cerrado y registrado en Ventas.</span></div><button className="secondary" onClick={() => void saveDraft(true)}><Printer size={15}/> Comanda</button><button className="secondary" onClick={() => void printInvoice()}><FileText size={15}/> Factura</button></div>}
          {message && <div className="workspace-success">{message}</div>}
          {error && <div className="workspace-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Cerrar">×</button></div>}
        </aside>
      </div>


      {checkoutOpen && <div className="item-editor-backdrop checkout-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) { setCheckoutOpen(false); paymentProgressRef.current = 0; setPaymentProgress(0) } }}>
        <section className="item-editor-modal checkout-editor-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
          <header className="item-editor-head checkout-editor-head">
            <div>
              <span className="item-editor-kicker">VERIFICAR PAGO</span>
              <h3 id="checkout-title">Confirma el cobro</h3>
              <p>Revisa el pedido, el medio de pago y el total antes de registrar la venta.</p>
            </div>
            <button className="item-editor-close" disabled={saving} onClick={() => { setCheckoutOpen(false); paymentProgressRef.current = 0; setPaymentProgress(0) }} aria-label="Cerrar"><X size={18}/></button>
          </header>

          <div className="item-editor-body checkout-editor-body">
            <div className="checkout-summary-card">
              <div className="checkout-summary-card-head"><div><span>Pedido</span><b>#{order?.orderNumber}</b></div><div><span>Productos</span><b>{items.length} líneas · {units} unidades</b></div></div>
              <div className="confirm-order-list">
                {items.map(item => <div className="confirm-order-item" key={item.lineId || item.productId}>
                  <div><b>{item.quantity}× {item.name}</b><span>{item.modification || item.category || 'Producto'}</span></div>
                  <strong>{money(item.quantity * item.unitPrice)}</strong>
                </div>)}
              </div>
            </div>

            <div className="item-editor-section checkout-payment-section">
              <div className="item-editor-section-head"><div><b>Medio de pago</b><span>Selecciona cómo te están pagando</span></div><strong>{paymentLabel(payment)}</strong></div>
              <div className="payment-grid checkout-payment-grid">{([['cash', 'Efectivo'], ['transfer', 'Transferencia'], ['card', 'Tarjeta']] as const).map(([value, label]) => <button key={value} className={payment === value ? 'selected' : ''} disabled={saving} onClick={() => setPayment(value)}>{label}</button>)}</div>
            </div>

            <div className="checkout-total-card"><span>Total a cobrar</span><strong>{money(total)}</strong>{dirty && <small>Los cambios pendientes se guardarán antes de cobrar.</small>}</div>

            <div className="checkout-slider-section">
              <div className="checkout-slider-head"><div><b>Desliza para confirmar</b><span>El pago solo se registra al llegar hasta el final.</span></div><span className={paymentProgress >= 96 ? 'checkout-slider-ready' : ''}>{paymentProgress >= 96 ? 'LISTO' : 'VERIFICACIÓN'}</span></div>
              <div ref={paymentSliderRef} className={`confirm-slider ${paymentProgress >= 96 ? 'ready' : ''}`}>
                <div className="confirm-slider-fill" style={{ width: `${Math.max(0, paymentProgress)}%` }} />
                <div className="confirm-slider-text">{saving ? 'Procesando pago…' : paymentProgress >= 96 ? 'Suelta para confirmar' : 'Arrastra el botón →'}</div>
                <button type="button" className="confirm-slider-thumb" style={{ left: `${Math.min(100, Math.max(0, paymentProgress))}%`, transform: `translateX(-${Math.min(100, Math.max(0, paymentProgress))}%)` }} onPointerDown={paymentSlideDown} onPointerMove={updatePaymentSlide} onPointerUp={paymentSlideUp} onPointerCancel={paymentSlideUp} disabled={saving} aria-label="Deslizar para confirmar el pago"><ArrowRight size={19}/></button>
              </div>
            </div>
            {error && <div className="workspace-error checkout-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Cerrar">×</button></div>}
          </div>

          <footer className="item-editor-footer checkout-editor-footer">
            <button className="secondary" disabled={saving} onClick={() => { setCheckoutOpen(false); paymentProgressRef.current = 0; setPaymentProgress(0) }}>Cancelar</button>
            <div className="checkout-footer-total"><span>Total</span><strong>{money(total)}</strong></div>
          </footer>
        </section>
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
