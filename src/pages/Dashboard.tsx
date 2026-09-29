import { Activity, ArrowUpRight, Banknote, ShoppingBag, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getSales } from '../lib/store'
import { date, money, time } from '../lib/format'
import type { Sale } from '../lib/types'
import { StatCard } from '../components/StatCard'
import { getSessionUser } from '../lib/auth'

export function Dashboard() {
  const [sales, setSales] = useState<Sale[]>([])
  const user = getSessionUser()
  useEffect(() => { getSales().then(setSales) }, [])
  const today = new Date().toDateString()
  const todaySales = sales.filter(s => new Date(s.createdAt).toDateString() === today)
  const total = todaySales.reduce((a,s) => a + s.total, 0)
  const average = todaySales.length ? total / todaySales.length : 0
  const cash = todaySales.filter(s => s.payment === 'cash').reduce((a,s) => a+s.total,0)
  const transfer = todaySales.filter(s => s.payment === 'transfer').reduce((a,s) => a+s.total,0)
  return <div>
    <div className="page-heading"><div><p className="eyebrow">HOY · {new Intl.DateTimeFormat('es-CO',{weekday:'long',day:'numeric',month:'long'}).format(new Date())}</p><h1>{user?.role !== 'employee' ? 'Apartado administrativo de Smaky' : `Hola, ${user?.name}. 👋`}</h1><p className="muted">{user?.role !== 'employee' ? 'Aquí tienes el pulso general de la operación.' : 'Aquí tienes tu resumen de operación en Smaky.'}</p></div><div className="sync-pill"><Activity size={15}/> Datos locales sincronizables</div></div>
    <div className="hero-metric"><div><span>Ventas de hoy</span><strong>{money(total)}</strong><small><ArrowUpRight size={14}/> {todaySales.length} pedidos registrados</small></div><div className="hero-bars"><i/><i/><i/><i/><i/><i/><i/><i/></div></div>
    <div className="stats-grid"><StatCard label="Pedidos" value={String(todaySales.length)} hint="Ventas del día" icon={<ShoppingBag size={17}/>} /><StatCard label="Ticket promedio" value={money(average)} hint="Por pedido" icon={<TrendingUp size={17}/>} /><StatCard label="Efectivo" value={money(cash)} hint="Registrado hoy" icon={<Banknote size={17}/>} /><StatCard label="Transferencias" value={money(transfer)} hint="Registrado hoy" icon={<Activity size={17}/>} /></div>
    <div className="dashboard-grid"><div className="panel"><div className="panel-title"><div><h2>Actividad reciente</h2><p>Últimas ventas registradas</p></div><a href="/ventas">Ver todas</a></div>{sales.slice(0,6).map(s => <div className="sale-row" key={s.id}><div className="sale-avatar">{s.items[0]?.name.charAt(0) ?? 'S'}</div><div className="sale-main"><b>{s.items.map(i=>`${i.quantity}× ${i.name}`).join(', ')}</b><span>{s.userName} · {time(s.createdAt)}</span></div><strong>{money(s.total)}</strong></div>)}</div><div className="panel"><div className="panel-title"><div><h2>Resumen del mes</h2><p>Base inicial del dashboard</p></div></div><div className="month-number">{money(sales.reduce((a,s)=>a+s.total,0))}</div><div className="progress"><span style={{width:'68%'}}/></div><div className="mini-list"><div><span>Ventas</span><b>{sales.length}</b></div><div><span>Última venta</span><b>{sales[0] ? date(sales[0].createdAt) : '—'}</b></div></div></div></div>
  </div>
}
