import { Check, CreditCard, FileText, PackageCheck, Pencil, Printer, RotateCcw, Truck, X, Plus, Minus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { completeOrder, getOrders, getSaleForOrder, updateOrderItems, updateOrderStatus } from '../lib/store'
import { date, money, time } from '../lib/format'
import type { Order, OrderStatus, PaymentMethod, SaleItem } from '../lib/types'
import { getSessionUser } from '../lib/auth'
import { printOrderComanda, printSaleReceipt } from '../lib/print'

const statusLabel: Record<OrderStatus, string> = { pending: 'Pendiente', preparing: 'En preparación', ready: 'Listo', delivered: 'Entregado', paid: 'Pagado', cancelled: 'Cancelado' }
const statusIcon = { pending: RotateCcw, preparing: RotateCcw, ready: PackageCheck, delivered: Truck, paid: Check, cancelled: X }
const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

const appendModification = (current: string | undefined, value: string) => {
  const next = value.trim()
  if (!next) return current || ''
  const parts = (current || '').split(' · ').map(item => item.trim()).filter(Boolean)
  if (!parts.some(item => item.toLowerCase() === next.toLowerCase())) parts.push(next)
  return parts.join(' · ')
}

export function Orders() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[]>([])
  const [selected, setSelected] = useState<Order | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [modifyOpen, setModifyOpen] = useState(false)
  const [draftItems, setDraftItems] = useState<SaleItem[]>([])
  const [payment, setPayment] = useState<PaymentMethod>('cash')
  const [saving, setSaving] = useState(false)
  const user = getSessionUser()

  const refresh = () => getOrders().then(all => setOrders(all.filter(order => dayKey(order.createdAt) === dayKey(new Date().toISOString()))))
  useEffect(() => { void refresh() }, [])

  const todayOrders = useMemo(() => orders.slice().sort((a, b) => b.orderNumber - a.orderNumber), [orders])
  const openCount = todayOrders.filter(order => !['paid', 'cancelled'].includes(order.status)).length

  const openDetails = (order: Order) => { setSelected(order); setModifyOpen(false); setCheckoutOpen(false) }
  const closeDetails = () => { setSelected(null); setModifyOpen(false); setCheckoutOpen(false) }

  const changeStatus = async (order: Order, status: OrderStatus) => {
    const updated = await updateOrderStatus(order.id, status)
    if (!updated) return
    setOrders(current => current.map(item => item.id === order.id ? updated : item))
    setSelected(updated)
  }

  const startModify = () => { if (!selected || ['paid', 'cancelled'].includes(selected.status)) return; setDraftItems(selected.items.map(item => ({ ...item }))); setModifyOpen(true) }

  const changeDraftQty = (productId: string, delta: number) => setDraftItems(current => current.flatMap(item => item.productId === productId
    ? (item.quantity + delta <= 0 ? [] : [{ ...item, quantity: item.quantity + delta, total: (item.quantity + delta) * item.unitPrice }])
    : [item]
  ))

  const setDraftModification = (productId: string, value: string) => setDraftItems(current => current.map(item => item.productId === productId ? { ...item, modification: value } : item))

  const saveModifications = async () => {
    if (!selected || !draftItems.length || saving) return
    const printTarget = window.open('', '_blank', 'width=420,height=720')
    setSaving(true)
    try {
      const updated = await updateOrderItems(selected.id, draftItems)
      if (!updated) return
      setOrders(current => current.map(item => item.id === selected.id ? updated : item))
      setSelected(updated)
      setModifyOpen(false)
      printOrderComanda(updated, printTarget)
    } catch { printTarget?.close() } finally { setSaving(false) }
  }

  const pay = async () => {
    if (!selected || !user || saving) return
    const printTarget = window.open('', '_blank', 'width=420,height=720')
    setSaving(true)
    try {
      const result = await completeOrder(selected.id, payment, user)
      if (!result) return
      setOrders(current => current.map(item => item.id === selected.id ? result.order : item))
      setSelected(result.order)
      setCheckoutOpen(false)
      printSaleReceipt(result.sale, printTarget)
    } catch { printTarget?.close() } finally { setSaving(false) }
  }

  const printInvoice = async () => {
    if (!selected || selected.status !== 'paid') return
    const sale = await getSaleForOrder(selected.id)
    if (sale) printSaleReceipt(sale)
  }

  const nextStatus = (order: Order) => {
    if (order.status === 'pending') return ['preparing', 'Iniciar preparación'] as const
    if (order.status === 'preparing') return ['ready', 'Marcar como listo'] as const
    if (order.status === 'ready') return ['delivered', 'Marcar entregado'] as const
    return null
  }

  return <div>
    <div className="page-heading compact">
      <div><p className="eyebrow">OPERACIÓN · HOY</p><h1>Pedidos</h1><p className="muted">Cada cuadro es un pedido de hoy. Entra para ver, modificar, imprimir o cobrar.</p></div>
      <div className="orders-top-actions"><span className="orders-count"><b>{todayOrders.length}</b> pedidos hoy · <b>{openCount}</b> abiertos</span><button className="primary-inline add-order-btn" onClick={() => navigate('/pos')}><Plus size={15}/> Agregar pedido</button></div>
    </div>

    {todayOrders.length === 0 ? <div className="orders-day-empty panel">
      <div className="orders-day-empty-icon"><FileText size={25}/></div><p className="eyebrow">SIN PEDIDOS TODAVÍA</p><h2>Hoy todavía no hay pedidos</h2><span>Registra el primero desde el punto de venta.</span><button className="primary-inline" onClick={() => navigate('/pos')}><Plus size={15}/> Registrar nuevo pedido</button>
    </div> : <div className="orders-grid">
      {todayOrders.map(order => { const Icon = statusIcon[order.status]; return <button className="order-square" key={order.id} onClick={() => openDetails(order)}>
        <div className="order-square-top"><span>Pedido</span><b>{order.orderNumber}</b></div>
        <div className="order-square-icon"><Icon size={21}/></div>
        <strong>{money(order.total)}</strong>
        <span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} productos</span>
        <small>{statusLabel[order.status]}</small>
        <em>{time(order.createdAt)}</em>
      </button> })}
    </div>}

    {selected && <div className="modal-backdrop order-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDetails() }}>
      <aside className="order-drawer" role="dialog" aria-modal="true">
        <button className="receipt-close" onClick={closeDetails} aria-label="Cerrar"><X size={18}/></button>
        <div className="order-drawer-head"><div><p className="eyebrow">PEDIDO {selected.orderNumber}</p><h2>Detalle del pedido</h2><span>{date(selected.createdAt)} · {time(selected.createdAt)} · {selected.userName}</span></div><span className={`order-status status-${selected.status}`}>{statusLabel[selected.status]}</span></div>

        <div className="order-drawer-section"><div className="drawer-section-title">Productos</div><div className="drawer-items">{selected.items.map(item => <div className="drawer-item" key={item.productId}><div className="drawer-item-main"><b>{item.quantity}× {item.name}</b><span>{money(item.unitPrice)} c/u</span>{item.modification && <small>✦ {item.modification}</small>}</div><strong>{money(item.total)}</strong></div>)}</div></div>
        <div className="drawer-total"><span>Total</span><strong>{money(selected.total)}</strong></div>

        <div className="drawer-actions">
          <button className="drawer-action" onClick={() => printOrderComanda(selected)}><span><Printer size={17}/></span><b>Comanda</b><small>Imprimir</small></button>
          <button className={`drawer-action ${selected.status !== 'paid' ? 'disabled' : ''}`} disabled={selected.status !== 'paid'} onClick={() => void printInvoice()}><span><FileText size={17}/></span><b>Factura</b><small>{selected.status === 'paid' ? 'Imprimir' : 'Al cobrar'}</small></button>
          <button className={`drawer-action ${['paid','cancelled'].includes(selected.status) ? 'disabled' : ''}`} disabled={['paid','cancelled'].includes(selected.status)} onClick={startModify}><span><Pencil size={17}/></span><b>Modificaciones</b><small>Editar pedido</small></button>
          <button className={`drawer-action pay ${selected.status === 'paid' ? 'disabled' : ''}`} disabled={selected.status === 'paid'} onClick={() => { setPayment('cash'); setCheckoutOpen(true) }}><span><CreditCard size={17}/></span><b>{selected.status === 'paid' ? 'Pagado' : 'Cobrar'}</b><small>{selected.status === 'paid' ? 'Pedido cerrado' : 'Registrar pago'}</small></button>
        </div>

        {nextStatus(selected) && <div className="drawer-next"><button className="secondary" onClick={() => { const next = nextStatus(selected); if (next) void changeStatus(selected, next[0]) }}>{nextStatus(selected)?.[1]}</button></div>}
      </aside>
    </div>}

    {modifyOpen && selected && <div className="modal-backdrop modification-backdrop">
      <div className="modification-modal" role="dialog" aria-modal="true">
        <button className="receipt-close" onClick={() => setModifyOpen(false)} aria-label="Cerrar"><X size={18}/></button>
        <p className="eyebrow">PEDIDO {selected.orderNumber}</p><h2>Modificar pedido</h2><p className="confirm-copy">Ajusta cantidades o escribe las indicaciones que necesita cocina. Al guardar se imprime una comanda actualizada.</p>
        <div className="modification-list">{draftItems.map(item => <div className="modification-item" key={item.productId}><div className="modification-item-top"><div><b>{item.name}</b><span>{money(item.unitPrice)} c/u</span></div><div className="qty"><button onClick={() => changeDraftQty(item.productId, -1)}><Minus size={13}/></button><b>{item.quantity}</b><button onClick={() => changeDraftQty(item.productId, 1)}><Plus size={13}/></button></div><strong>{money(item.total)}</strong></div><textarea rows={2} value={item.modification || ''} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraftModification(item.productId, e.target.value)} placeholder="Ej: sin salsas, sin tomate, sin lechuga..."/><div className="mod-chips">{['Sin salsas','Sin tomate','Sin lechuga','Sin cebolla','Sin queso'].map(chip => <button key={chip} onClick={() => setDraftModification(item.productId, appendModification(item.modification, chip))}>{chip}</button>)}</div>{draftItems.length > 1 && <button className="remove-mod-item" onClick={() => setDraftItems(current => current.filter(x => x.productId !== item.productId))}><Trash2 size={13}/> Quitar del pedido</button>}</div>)}</div>
        <div className="modification-total"><span>Nuevo total</span><strong>{money(draftItems.reduce((sum, item) => sum + item.total, 0))}</strong></div>
        <button className="primary" disabled={!draftItems.length || saving} onClick={() => void saveModifications}>{saving ? 'Guardando…' : 'Guardar cambios e imprimir comanda'}</button>
      </div>
    </div>}

    {checkoutOpen && selected && <div className="modal-backdrop checkout-order-backdrop">
      <div className="checkout-order-modal" role="dialog" aria-modal="true">
        <button className="receipt-close" onClick={() => setCheckoutOpen(false)} aria-label="Cerrar"><X size={18}/></button>
        <div className="confirm-icon"><CreditCard size={19}/></div><p className="eyebrow">COBRAR PEDIDO {selected.orderNumber}</p><h2>Registrar pago</h2><p className="confirm-copy">El pedido pasará a Ventas y se imprimirá el comprobante.</p>
        <div className="payment-grid checkout-payment-grid">{([['cash', 'Efectivo'], ['transfer', 'Transferencia'], ['card', 'Tarjeta']] as const).map(([value, label]) => <button className={payment === value ? 'selected' : ''} onClick={() => setPayment(value)} key={value}>{label}</button>)}</div>
        <div className="checkout-order-total"><span>Total a cobrar</span><strong>{money(selected.total)}</strong></div>
        <button className="primary" disabled={saving} onClick={() => void pay}>{saving ? 'Guardando…' : 'Confirmar pago e imprimir factura'}</button>
      </div>
    </div>}
  </div>
}
