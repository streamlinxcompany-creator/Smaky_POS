import { AlertTriangle, FileText, Plus, UtensilsCrossed, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { OrderWorkspace } from '../components/OrderWorkspace'
import { getSessionUser } from '../lib/auth'
import { getClosureByDate, getOrders, recordBusinessDayKey } from '../lib/store'
import { date, money, time } from '../lib/format'
import type { CashClosure, Order, OrderStatus } from '../lib/types'

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

const isOpenOrder = (order: Order) => !['paid', 'cancelled'].includes(order.status)

export function POS() {
  const user = getSessionUser()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Order | null>(null)
  const [todayClosure, setTodayClosure] = useState<CashClosure | null>(null)
  const [closureWarning, setClosureWarning] = useState<CashClosure | null>(null)

  const refresh = async () => {
    const currentCalendarKey = dayKey(new Date().toISOString())
    const closure = await getClosureByDate(currentCalendarKey)
    setTodayClosure(closure ?? null)
    const activeKey = closure?.nextDateKey ?? currentCalendarKey
    const all = await getOrders()
    setOrders(all
      .filter(order => recordBusinessDayKey(order) === activeKey && isOpenOrder(order))
      .sort((a, b) => b.orderNumber - a.orderNumber))
    setLoading(false)
  }

  useEffect(() => { void refresh() }, [])

  const todayOrders = useMemo(() => orders.slice().sort((a, b) => b.orderNumber - a.orderNumber), [orders])

  const updateLocalOrder = (updated: Order) => {
    const activeKey = todayClosure?.nextDateKey ?? dayKey(new Date().toISOString())
    if (!isOpenOrder(updated) || recordBusinessDayKey(updated) !== activeKey) {
      setOrders(current => current.filter(item => item.id !== updated.id))
      setSelected(current => current?.id === updated.id ? null : current)
      return
    }
    setOrders(current => {
      const exists = current.some(item => item.id === updated.id)
      const next = exists ? current.map(item => item.id === updated.id ? updated : item) : [...current, updated]
      return next.sort((a, b) => b.orderNumber - a.orderNumber)
    })
  }

  const beginNewOrder = () => {
    if (todayClosure) {
      setClosureWarning(todayClosure)
      return
    }
    setCreating(true)
  }

  const continueAfterClosure = () => {
    setClosureWarning(null)
    setCreating(true)
  }

  const closureWarningModal = closureWarning ? <div className="item-editor-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setClosureWarning(null) }}>
    <section className="item-editor-modal pos-closure-warning-modal" role="dialog" aria-modal="true" aria-labelledby="pos-closure-warning-title">
      <header className="item-editor-head">
        <div><span className="item-editor-kicker danger-kicker">CIERRE REALIZADO</span><h3 id="pos-closure-warning-title">El cierre del día ya fue realizado</h3><p>Las nuevas operaciones no se bloquean: se registrarán automáticamente en el siguiente periodo.</p></div>
        <button className="item-editor-close" onClick={() => setClosureWarning(null)} aria-label="Cerrar"><X size={18}/></button>
      </header>
      <div className="item-editor-body pos-closure-warning-body">
        <div className="pos-closure-warning-box"><div className="pos-closure-warning-icon"><AlertTriangle size={21}/></div><div><b>Cierre del {closureWarning.dateKey.split('-').reverse().join('/')}</b><span>Ya existe un cierre administrativo para este día. Registrar un nuevo pedido no modificará ese cierre.</span></div></div>
        <div className="pos-closure-next-card"><span>NUEVO PERIODO OPERATIVO</span><strong>{closureWarning.nextDateKey.split('-').reverse().join('/')}</strong><small>Todo pedido y venta que registres ahora quedará asociado al periodo del <b>{closureWarning.nextDateKey.split('-').reverse().join('/')}</b>.</small></div>
      </div>
      <footer className="item-editor-footer"><button className="secondary" onClick={() => setClosureWarning(null)}>Cancelar</button><button className="primary" onClick={continueAfterClosure}><Plus size={15}/> Continuar con el nuevo periodo</button></footer>
    </section>
  </div> : null

  if (!user) return null

  if (creating) return <OrderWorkspace
    user={user}
    onClose={() => { setCreating(false); void refresh() }}
    onOrderChange={updateLocalOrder}
  />

  if (selected) return <OrderWorkspace
    user={user}
    initialOrder={selected}
    onClose={() => { setSelected(null); void refresh() }}
    onOrderChange={updateLocalOrder}
  />

  if (loading) return <div className="pos-orders-page"><div className="pos-orders-loading">Cargando pedidos de hoy…</div></div>

  if (!todayOrders.length) return <div className="pos-landing">
    <div className="pos-landing-card">
      <div className="pos-landing-icon"><UtensilsCrossed size={26}/></div>
      <p className="eyebrow">PUNTO DE VENTA</p>
      <h1>Registrar nuevo pedido</h1>
      <p>Un solo panel para agregar productos, poner modificaciones, imprimir la comanda y cobrar cuando corresponda.</p>
      <button className="primary landing-primary" onClick={beginNewOrder}><Plus size={18}/> Registrar nuevo pedido</button>
    </div>
    {closureWarningModal}
  </div>

  return <div className="pos-orders-page">
    <div className="page-heading compact pos-orders-heading">
      <div>
        <p className="eyebrow">PUNTO DE VENTA</p>
        <h1>Pedidos de hoy</h1>
        <p className="muted">Trabaja los pedidos abiertos desde aquí. Al cobrar, pasan automáticamente a Ventas.</p>
      </div>
      <div className="pos-orders-top-actions">
        <span className="orders-count"><b>{todayOrders.length}</b> {todayOrders.length === 1 ? 'pedido abierto' : 'pedidos abiertos'}</span>
        <button className="primary-inline add-order-btn" onClick={beginNewOrder}><Plus size={15}/> Registrar nuevo pedido</button>
      </div>
    </div>

    <div className="pos-orders-grid">
      {todayOrders.map(order => <button className={`order-square status-card-${order.status}`} key={order.id} onClick={() => setSelected(order)}>
        <div className="order-square-top"><span>Pedido</span><b>#{order.orderNumber}</b></div>
        <div className="order-square-icon"><FileText size={19}/></div>
        <strong>{money(order.total)}</strong>
        <span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} {order.items.reduce((sum, item) => sum + item.quantity, 0) === 1 ? 'producto' : 'productos'}</span>
        <small>{statusLabel[order.status]}</small>
        {order.comandaStatus === 'skipped' && <em>Sin comanda</em>}
        <em>{date(order.createdAt)} · {time(order.createdAt)}</em>
      </button>)}
    </div>

    {closureWarningModal}
  </div>
}
