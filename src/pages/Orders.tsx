import { FileText, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OrderWorkspace } from '../components/OrderWorkspace'
import { getOrders } from '../lib/store'
import { date, money, time } from '../lib/format'
import type { Order, OrderStatus } from '../lib/types'
import { getSessionUser } from '../lib/auth'

const statusLabel: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  preparing: 'En preparación',
  ready: 'Listo',
  delivered: 'Entregado',
  paid: 'Pagado',
  cancelled: 'Cancelado'
}

const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(iso))

export function Orders() {
  const navigate = useNavigate()
  const user = getSessionUser()
  const [orders, setOrders] = useState<Order[]>([])
  const [selected, setSelected] = useState<Order | null>(null)

  const refresh = () => getOrders().then(all => setOrders(all.filter(order => dayKey(order.createdAt) === dayKey(new Date().toISOString()) && !['paid', 'cancelled'].includes(order.status))))
  useEffect(() => { void refresh() }, [])

  const todayOrders = useMemo(() => orders.slice().sort((a, b) => b.orderNumber - a.orderNumber), [orders])
  const openCount = todayOrders.length

  const updateLocalOrder = (updated: Order) => {
    if (['paid', 'cancelled'].includes(updated.status)) {
      setOrders(current => current.filter(item => item.id !== updated.id))
      setSelected(null)
      return
    }
    setOrders(current => current.map(item => item.id === updated.id ? updated : item))
    setSelected(updated)
  }

  if (selected && user) return <OrderWorkspace
    user={user}
    initialOrder={selected}
    onClose={() => setSelected(null)}
    onOrderChange={updateLocalOrder}
  />

  return <div>
    <div className="page-heading compact">
      <div><p className="eyebrow">OPERACIÓN · HOY</p><h1>Pedidos</h1><p className="muted">Abre cualquier pedido y trabaja todo desde un solo panel: productos, modificaciones, comanda y cobro.</p></div>
      <div className="orders-top-actions"><span className="orders-count"><b>{todayOrders.length}</b> pendientes hoy · <b>{openCount}</b> por cobrar</span><button className="primary-inline add-order-btn" onClick={() => navigate('/pos')}><Plus size={15}/> Agregar pedido</button></div>
    </div>

    {todayOrders.length === 0 ? <div className="orders-day-empty panel">
      <div className="orders-day-empty-icon"><FileText size={25}/></div><p className="eyebrow">TODO AL DÍA</p><h2>No hay pedidos pendientes</h2><span>Los pedidos cobrados pasan automáticamente a Ventas.</span><button className="primary-inline" onClick={() => navigate('/pos')}><Plus size={15}/> Registrar nuevo pedido</button>
    </div> : <div className="orders-grid">
      {todayOrders.map(order => <button className={`order-square status-card-${order.status}`} key={order.id} onClick={() => setSelected(order)}>
        <div className="order-square-top"><span>Pedido</span><b>#{order.orderNumber}</b></div>
        <div className="order-square-icon">🍔</div>
        <strong>{money(order.total)}</strong>
        <span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} productos</span>
        <small>{statusLabel[order.status]}</small>
        <em>{date(order.createdAt)} · {time(order.createdAt)}</em>
      </button>)}
    </div>}

  </div>
}
