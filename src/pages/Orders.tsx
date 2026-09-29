import { Check, Circle, Clock3, CreditCard, MapPin, PackageCheck, Printer, RotateCcw, Truck, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { completeOrder, getOrders, updateOrderStatus } from '../lib/store'
import { date, money, time } from '../lib/format'
import type { LucideIcon } from 'lucide-react'
import type { Order, OrderStatus, PaymentMethod } from '../lib/types'
import { getSessionUser } from '../lib/auth'
import { printOrderComanda, printSaleReceipt } from '../lib/print'

const statusLabel: Record<OrderStatus, string> = { pending: 'Pendiente', preparing: 'En preparación', ready: 'Listo', delivered: 'Entregado', paid: 'Pagado', cancelled: 'Cancelado' }
const statusIcon: Record<OrderStatus, LucideIcon> = { pending: Clock3, preparing: RotateCcw, ready: PackageCheck, delivered: Truck, paid: Check, cancelled: X }

export function Orders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [selected, setSelected] = useState<Order | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [payment, setPayment] = useState<PaymentMethod>('cash')
  const [saving, setSaving] = useState(false)
  const user = getSessionUser()

  const refresh = () => getOrders().then(setOrders)
  useEffect(() => { void refresh() }, [])

  const openOrders = useMemo(() => orders.filter(order => !['paid', 'cancelled'].includes(order.status)), [orders])
  const grouped = useMemo(() => ({
    pending: openOrders.filter(o => o.status === 'pending'),
    preparing: openOrders.filter(o => o.status === 'preparing'),
    ready: openOrders.filter(o => o.status === 'ready'),
    delivered: openOrders.filter(o => o.status === 'delivered')
  }), [openOrders])

  const changeStatus = async (order: Order, status: OrderStatus) => {
    const updated = await updateOrderStatus(order.id, status)
    if (!updated) return
    setOrders(current => current.map(item => item.id === order.id ? updated : item))
    setSelected(updated)
  }

  const startCheckout = () => { if (selected) { setPayment('cash'); setCheckoutOpen(true) } }

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
    } catch (error) {
      printTarget?.close()
      throw error
    } finally { setSaving(false) }
  }

  const columns: { key: keyof typeof grouped; title: string }[] = [
    { key: 'pending', title: 'Pendientes' },
    { key: 'preparing', title: 'En preparación' },
    { key: 'ready', title: 'Listos' },
    { key: 'delivered', title: 'Entregados' }
  ]

  return <div>
    <div className="page-heading compact">
      <div><p className="eyebrow">OPERACIÓN</p><h1>Pedidos</h1><p className="muted">Aquí viven los domicilios desde que se registran hasta que se cobran.</p></div>
      <div className="orders-count"><b>{openOrders.length}</b> abiertos</div>
    </div>

    <div className="orders-board">
      {columns.map(column => {
        const Icon = statusIcon[column.key]
        return <section className="orders-column" key={column.key}>
          <div className="orders-column-head"><div><h2>{column.title}</h2><span>{grouped[column.key].length} pedidos</span></div><Icon size={17}/></div>
          <div className="orders-list">
            {grouped[column.key].length === 0 ? <div className="orders-empty"><Circle size={15}/><span>Sin pedidos</span></div> : grouped[column.key].map(order => <button className="order-card" key={order.id} onClick={() => setSelected(order)}>
              <div className="order-card-top"><b>#{order.orderNumber}</b><span>{time(order.createdAt)}</span></div>
              <strong>{order.customerName}</strong>
              <span className="order-address"><MapPin size={12}/> {order.address}</span>
              <div className="order-card-bottom"><span>{order.items.reduce((a, i) => a + i.quantity, 0)} productos</span><strong>{money(order.total)}</strong></div>
            </button>)}
          </div>
        </section>
      })}
    </div>

    {selected && <div className="modal-backdrop orders-backdrop">
      <div className="order-detail-modal" role="dialog" aria-modal="true">
        <button className="receipt-close" onClick={() => { setSelected(null); setCheckoutOpen(false) }} aria-label="Cerrar"><X size={18}/></button>
        <div className="order-detail-head"><div><p className="eyebrow">PEDIDO #{selected.orderNumber}</p><h2>{selected.customerName}</h2><span>{date(selected.createdAt)} · {time(selected.createdAt)} · {selected.userName}</span></div><span className={`order-status status-${selected.status}`}>{statusLabel[selected.status]}</span></div>

        <div className="order-detail-grid"><div><span>Teléfono</span><b>{selected.phone || 'No registrado'}</b></div><div><span>Dirección</span><b>{selected.address}</b></div></div>
        {selected.notes && <div className="order-notes"><b>Observaciones</b><span>{selected.notes}</span></div>}

        <div className="receipt-section-title">Productos</div>
        <div className="receipt-items">{selected.items.map(item => <div className="receipt-item" key={item.productId}><div><b>{item.quantity}× {item.name}</b><span>{money(item.unitPrice)} c/u</span></div><strong>{money(item.total)}</strong></div>)}</div>
        <div className="receipt-total"><div className="grand"><span>Total</span><strong>{money(selected.total)}</strong></div></div>

        <div className="order-actions">
          <button className="secondary" onClick={() => printOrderComanda(selected)}><Printer size={15}/> Reimprimir comanda</button>
          {selected.status === 'pending' && <button className="primary-inline" onClick={() => void changeStatus(selected, 'preparing')}>Iniciar preparación</button>}
          {selected.status === 'preparing' && <button className="primary-inline" onClick={() => void changeStatus(selected, 'ready')}>Marcar listo</button>}
          {selected.status === 'ready' && <button className="primary-inline" onClick={() => void changeStatus(selected, 'delivered')}>Marcar entregado</button>}
          {selected.status === 'delivered' && <button className="primary-inline pay-button" onClick={startCheckout}><CreditCard size={15}/> Cobrar pedido</button>}
        </div>
      </div>
    </div>}

    {checkoutOpen && selected && <div className="modal-backdrop checkout-order-backdrop">
      <div className="checkout-order-modal" role="dialog" aria-modal="true">
        <button className="receipt-close" onClick={() => setCheckoutOpen(false)} aria-label="Cerrar"><X size={18}/></button>
        <div className="confirm-icon"><CreditCard size={19}/></div>
        <p className="eyebrow">COBRAR PEDIDO #{selected.orderNumber}</p>
        <h2>Registrar pago</h2>
        <p className="confirm-copy">Elige el medio de pago. Al confirmar, el pedido pasa a Ventas y se imprime el comprobante.</p>
        <div className="payment-grid checkout-payment-grid">{([['cash', 'Efectivo'], ['transfer', 'Transferencia'], ['card', 'Tarjeta']] as const).map(([value, label]) => <button className={payment === value ? 'selected' : ''} onClick={() => setPayment(value)} key={value}>{label}</button>)}</div>
        <div className="checkout-order-total"><span>Total a cobrar</span><strong>{money(selected.total)}</strong></div>
        <button className="primary" disabled={saving} onClick={() => void pay}>{saving ? 'Guardando…' : 'Confirmar pago e imprimir'}</button>
      </div>
    </div>}
  </div>
}
