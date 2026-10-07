import { Activity, ArrowUpRight, Banknote, CheckCircle2, FileText, LockKeyhole, ReceiptText, ShoppingBag, TrendingUp, AlertTriangle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getClosures, businessDayKey, getSales, recordBusinessDayKey } from '../lib/store'
import { date, money, time } from '../lib/format'
import type { CashClosure, Sale } from '../lib/types'
import { StatCard } from '../components/StatCard'
import { getSessionUser } from '../lib/auth'
import { useNavigate } from 'react-router-dom'

const safeSaleItems = (sale: Sale) => Array.isArray(sale.items) ? sale.items.filter(item => item && typeof item === 'object') : []
const safeSaleName = (sale: Sale) => safeSaleItems(sale).map(item => `${Number(item.quantity) || 0}× ${String(item.name || 'Producto')}`).join(', ') || 'Venta registrada'
const safeSaleAvatar = (sale: Sale) => String(safeSaleItems(sale)[0]?.name || 'S').charAt(0)

export function Dashboard() {
  const [sales, setSales] = useState<Sale[]>([])
  const [closures, setClosures] = useState<CashClosure[]>([])
  const user = getSessionUser()
  const navigate = useNavigate()
  useEffect(() => { Promise.all([getSales(), getClosures()]).then(([salesData, closureData]) => { setSales(salesData); setClosures(closureData) }) }, [])
  const todayKey = businessDayKey(new Date())
  const todayClosure = useMemo(() => closures.find(closure => closure.dateKey === todayKey), [closures, todayKey])
  const activeKey = todayClosure?.nextDateKey ?? todayKey
  const todaySales = useMemo(() => sales.filter(s => {
    try { return recordBusinessDayKey(s) === activeKey } catch { return false }
  }), [sales, activeKey])
  const total = todaySales.reduce((a,s) => a + s.total, 0)
  const average = todaySales.length ? total / todaySales.length : 0
  const cash = todaySales.filter(s => s.payment === 'cash').reduce((a,s) => a+s.total,0)
  const transfer = todaySales.filter(s => s.payment === 'transfer').reduce((a,s) => a+s.total,0)
  const isAdmin = user?.role !== 'employee'

  if (isAdmin) return <div className="admin-dashboard-page">
    <div className="page-heading"><div><p className="eyebrow">CENTRO DE CONTROL · PERIODO ACTIVO</p><h1>Administración de Smaky</h1><p className="muted">Resumen operativo, estado del cierre y acceso rápido a los movimientos administrativos.</p></div><button className={`admin-close-status ${todayClosure ? 'closed' : 'pending'}`} onClick={() => navigate('/cierre-caja')}>{todayClosure ? <CheckCircle2 size={15}/> : <LockKeyhole size={15}/>} {todayClosure ? 'Cierre realizado' : 'Cierre pendiente'}</button></div>
    <div className="admin-hero"><div><span>Facturación de hoy</span><strong>{money(total)}</strong><small><ReceiptText size={14}/> {todaySales.length} {todaySales.length === 1 ? 'factura registrada' : 'facturas registradas'}</small></div><div className="admin-hero-side"><span>{todayClosure ? 'ÚLTIMO CIERRE REALIZADO' : 'CIERRE PENDIENTE'}</span><b>{todayClosure ? `${date(todayClosure.closedAt)} · ${time(todayClosure.closedAt)} · próximo periodo ${activeKey.split('-').reverse().join('/')}` : `Periodo activo ${activeKey.split('-').reverse().join('/')}`}</b></div></div>
    <div className="stats-grid admin-stats"><StatCard label="Ventas" value={String(todaySales.length)} hint="Facturas del día" icon={<ShoppingBag size={17}/>} /><StatCard label="Ticket promedio" value={money(average)} hint="Por factura" icon={<TrendingUp size={17}/>} /><StatCard label="Efectivo" value={money(cash)} hint="Registrado hoy" icon={<Banknote size={17}/>} /><StatCard label="Transferencias" value={money(transfer)} hint="Registrado hoy" icon={<Activity size={17}/>} /></div>
    <div className="admin-control-grid">
      <section className="panel admin-control-card"><div className="panel-title"><div><h2>Control del cierre</h2><p>Revisa antes de cerrar el día.</p></div><LockKeyhole size={17}/></div>{todayClosure ? <div className="admin-closed-summary"><div className="admin-state-icon"><CheckCircle2 size={18}/></div><div><b>El cierre del {todayKey.split('-').reverse().join('/')} está realizado</b><span>El cierre quedó guardado con {todayClosure.saleCount} {todayClosure.saleCount === 1 ? 'factura' : 'facturas'} y un total de {money(todayClosure.total)}.</span></div><button className="secondary" onClick={() => navigate('/cierre-caja')}><FileText size={14}/> Ver cierre</button></div> : <div className="admin-pending-summary"><div className="admin-state-icon pending"><AlertTriangle size={18}/></div><div><b>El cierre del periodo {activeKey.split('-').reverse().join('/')} está pendiente</b><span>{todaySales.length ? `Hay ${todaySales.length} facturas registradas. Puedes revisar el efectivo y cerrar el día desde el módulo administrativo.` : 'Todavía no hay ventas registradas para este día.'}</span></div><button className="primary-inline" onClick={() => navigate('/cierre-caja')}><LockKeyhole size={14}/> Ir a cierre</button></div>}</section>
      <section className="panel admin-control-card"><div className="panel-title"><div><h2>Últimos cierres</h2><p>Acceso directo al historial.</p></div><button className="panel-link-btn" onClick={() => navigate('/cierre-caja')}>Ver todo</button></div>{!closures.length ? <div className="admin-mini-empty"><ReceiptText size={22}/><span>Aún no hay cierres.</span></div> : <div className="admin-closure-mini-list">{closures.slice(0,4).map(closure => <button key={closure.id} onClick={() => navigate('/cierre-caja')}><span>{closure.dateKey.split('-').reverse().join('/')}</span><b>{money(closure.total)}</b><em className={closure.cashDifference === 0 ? 'ok' : ''}>{closure.cashDifference === 0 ? 'Cuadrada' : `${closure.cashDifference > 0 ? '+' : ''}${money(closure.cashDifference)}`}</em></button>)}</div>}</section>
    </div>
    <div className="dashboard-grid admin-activity-grid"><div className="panel"><div className="panel-title"><div><h2>Actividad reciente</h2><p>Últimas facturas registradas</p></div><a href="/ventas">Ver todas</a></div>{sales.slice(0,6).map(s => <div className="sale-row" key={s.id}><div className="sale-avatar">{safeSaleAvatar(s)}</div><div className="sale-main"><b>{safeSaleName(s)}</b><span>{s.userName} · {time(s.createdAt)}</span></div><strong>{money(s.total)}</strong></div>)}</div><div className="panel"><div className="panel-title"><div><h2>Resumen administrativo</h2><p>Lectura rápida del negocio</p></div></div><div className="admin-summary-number">{money(sales.reduce((a,s)=>a+s.total,0))}</div><div className="progress"><span style={{width:'68%'}}/></div><div className="mini-list"><div><span>Facturas acumuladas</span><b>{sales.length}</b></div><div><span>Último cierre</span><b>{closures[0] ? `${closures[0].dateKey.split('-').reverse().join('/')} · ${money(closures[0].total)}` : '—'}</b></div></div></div></div>
  </div>

  return <div>
    <div className="page-heading"><div><p className="eyebrow">HOY · {new Intl.DateTimeFormat('es-CO',{weekday:'long',day:'numeric',month:'long'}).format(new Date())}</p><h1>Hola, {user?.name}. 👋</h1><p className="muted">Aquí tienes tu resumen de operación en Smaky.</p></div><div className="sync-pill"><Activity size={15}/> Datos locales sincronizables</div></div>
    <div className="hero-metric"><div><span>Ventas de hoy</span><strong>{money(total)}</strong><small><ArrowUpRight size={14}/> {todaySales.length} pedidos registrados</small></div><div className="hero-bars"><i/><i/><i/><i/><i/><i/><i/><i/></div></div>
    <div className="stats-grid"><StatCard label="Pedidos" value={String(todaySales.length)} hint="Ventas del día" icon={<ShoppingBag size={17}/>} /><StatCard label="Ticket promedio" value={money(average)} hint="Por pedido" icon={<TrendingUp size={17}/>} /><StatCard label="Efectivo" value={money(cash)} hint="Registrado hoy" icon={<Banknote size={17}/>} /><StatCard label="Transferencias" value={money(transfer)} hint="Registrado hoy" icon={<Activity size={17}/>} /></div>
    <div className="dashboard-grid"><div className="panel"><div className="panel-title"><div><h2>Actividad reciente</h2><p>Últimas ventas registradas</p></div><a href="/ventas">Ver todas</a></div>{sales.slice(0,6).map(s => <div className="sale-row" key={s.id}><div className="sale-avatar">{safeSaleAvatar(s)}</div><div className="sale-main"><b>{safeSaleName(s)}</b><span>{s.userName} · {time(s.createdAt)}</span></div><strong>{money(s.total)}</strong></div>)}</div><div className="panel"><div className="panel-title"><div><h2>Resumen del mes</h2><p>Base inicial del dashboard</p></div></div><div className="month-number">{money(sales.reduce((a,s)=>a+s.total,0))}</div><div className="progress"><span style={{width:'68%'}}/></div><div className="mini-list"><div><span>Ventas</span><b>{sales.length}</b></div><div><span>Última venta</span><b>{sales[0] ? date(sales[0].createdAt) : '—'}</b></div></div></div></div>
  </div>
}
