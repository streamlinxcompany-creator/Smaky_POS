import { useEffect, useMemo, useState } from 'react'
import { Activity, BarChart3, Boxes, Database, Eye, EyeOff, KeyRound, LogOut, LockKeyhole, ShieldCheck, ShoppingCart, Sparkles, UsersRound, Wifi, X } from 'lucide-react'
import { businessDayKey, getAllProducts, getCurrentBusinessDayKey, getOrders, getSales, getUsers, recordBusinessDayKey } from '../lib/store'
import type { Order, Product, Sale, User } from '../lib/types'

const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const shortMoney = (value: number) => money.format(value).replace(',00', '')
const time = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' })
const dateLabel = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })

function Stat({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: typeof Activity }) {
  return <div className="slx-stat">
    <div className="slx-stat-top"><span>{label}</span><i><Icon size={15} /></i></div>
    <strong>{value}</strong>
    <small>{hint}</small>
  </div>
}

function summarize(sales: Sale[], orders: Order[], products: Product[], users: User[], todayKey: string) {
  const todaySales = sales.filter(sale => recordBusinessDayKey(sale) === todayKey)
  const todayOrders = orders.filter(order => recordBusinessDayKey(order) === todayKey)
  const revenue = todaySales.reduce((sum, sale) => sum + sale.total, 0)
  const totalUnits = todaySales.reduce((sum, sale) => sum + sale.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0)
  const basket = todaySales.length ? revenue / todaySales.length : 0
  const productMap = new Map<string, number>()
  for (const sale of todaySales) for (const item of sale.items) productMap.set(item.name, (productMap.get(item.name) || 0) + item.quantity)
  const topProduct = [...productMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Sin datos'

  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date()
    date.setDate(date.getDate() - (6 - offset))
    const key = businessDayKey(date)
    return { key, value: sales.filter(sale => recordBusinessDayKey(sale) === key).reduce((sum, sale) => sum + sale.total, 0) }
  })

  return {
    todayKey,
    todaySales,
    todayOrders,
    revenue,
    totalUnits,
    basket,
    topProduct,
    activeProducts: products.filter(product => product.active).length,
    users: users.filter(user => user.active).length,
    pendingOrders: todayOrders.filter(order => !['paid', 'cancelled'].includes(order.status)).length,
    week: days
  }
}

export function StreamLinxCore({ onExit }: { onExit: () => void }) {
  const [sales, setSales] = useState<Sale[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showVault, setShowVault] = useState(false)
  const [clock, setClock] = useState(new Date())
  const [currentBusinessKey, setCurrentBusinessKey] = useState(businessDayKey(new Date()))

  useEffect(() => {
    Promise.all([getSales(), getOrders(), getAllProducts(), getUsers(), getCurrentBusinessDayKey()]).then(([salesData, orderData, productData, userData, businessKey]) => {
      setSales(salesData); setOrders(orderData); setProducts(productData); setUsers(userData); setCurrentBusinessKey(businessKey)
    }).finally(() => setLoading(false))
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const data = useMemo(() => summarize(sales, orders, products, users, currentBusinessKey), [sales, orders, products, users, currentBusinessKey])
  const maxWeek = Math.max(...data.week.map(day => day.value), 1)
  const latest = data.todaySales[0]

  if (loading) return <div className="slx-root slx-core-loading"><div className="slx-core-loader"><Sparkles size={19} /><span>MAICOL / indexing client data...</span></div></div>

  return <div className="slx-root slx-core-root">
    <div className="slx-core-noise" />
    <aside className="slx-core-sidebar">
      <div className="slx-core-brand">
        <div className="slx-core-logo"><img src="/Streamlinx.png" alt="StreamLinx" onError={(event) => { event.currentTarget.style.display = 'none' }} /><span>SLX</span></div>
        <div><b>STREAMLINX</b><small>PRIVATE CORE</small></div>
      </div>
      <div className="slx-node-card"><span className="slx-live-dot" /><div><b>NODE 01</b><small>SMaky / LOCAL</small></div><Wifi size={14} /></div>
      <nav className="slx-core-nav"><div className="active"><BarChart3 size={16} /><span>Command center</span></div><div><Activity size={16} /><span>Live intelligence</span></div><div><Database size={16} /><span>Data layer</span></div><button onClick={() => setShowVault(true)}><KeyRound size={16} /><span>Secure vault</span></button></nav>
      <div className="slx-core-sidebar-bottom">
        <div className="slx-maicol-card"><div className="slx-maicol-head"><Sparkles size={14} /><span>MAICOL</span><em>ACTIVE</em></div><p>“Client environment indexed. No critical anomalies detected.”</p></div>
        <button className="slx-exit" onClick={onExit}><LogOut size={15} /> Exit private core</button>
      </div>
    </aside>

    <main className="slx-core-main">
      <header className="slx-core-topbar">
        <div><span className="slx-kicker">STREAMLINX // PRIVATE CORE</span><h1>Command center</h1></div>
        <div className="slx-top-meta"><span>{dateLabel.format(clock)}</span><span className="slx-separator">•</span><span>{time.format(clock)}</span><div className="slx-secure-pill"><ShieldCheck size={13} /> SECURE</div><button onClick={onExit} aria-label="Salir"><X size={16} /></button></div>
      </header>

      <section className="slx-core-content">
        <div className="slx-hero-core">
          <div>
            <span className="slx-kicker">CLIENT // SMAKY</span>
            <h2>STREAMLINX // PRIVATE CORE</h2>
            <p>Una lectura interna del entorno operativo. La capa visible de Smaky nunca muestra este espacio.</p>
          </div>
          <div className="slx-hero-system"><div><span>SYSTEM</span><b>ONLINE</b></div><div><span>MAICOL</span><b>ACTIVE</b></div><div><span>DATA</span><b>SYNCED</b></div></div>
        </div>

        <div className="slx-stats-grid">
          <Stat label="REVENUE / TODAY" value={shortMoney(data.revenue)} hint={`${data.todaySales.length} ventas registradas`} icon={BarChart3} />
          <Stat label="AVG. TICKET" value={shortMoney(data.basket)} hint={`${data.totalUnits} unidades vendidas`} icon={ShoppingCart} />
          <Stat label="ACTIVE STAFF" value={String(data.users).padStart(2, '0')} hint={`${data.activeProducts} productos activos`} icon={UsersRound} />
          <Stat label="OPEN ORDERS" value={String(data.pendingOrders).padStart(2, '0')} hint={`${data.todayOrders.length} pedidos del día`} icon={Boxes} />
        </div>

        <div className="slx-grid-two">
          <section className="slx-panel slx-chart-panel">
            <div className="slx-panel-head"><div><span className="slx-kicker">BUSINESS SIGNAL</span><h3>Flujo de ingresos</h3></div><span className="slx-panel-tag">7 DAYS</span></div>
            <div className="slx-chart"><div className="slx-chart-grid"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0</span></div><div className="slx-bars">{data.week.map((day, index) => <div className="slx-bar-col" key={day.key} title={`${day.key}: ${shortMoney(day.value)}`}><i style={{ height: `${Math.max(8, (day.value / maxWeek) * 100)}%` }} /><span>D{index + 1}</span></div>)}</div></div>
            <div className="slx-chart-foot"><span>Periodo actual</span><b>{shortMoney(data.revenue)}</b></div>
          </section>

          <section className="slx-panel slx-intel-panel">
            <div className="slx-panel-head"><div><span className="slx-kicker">MAICOL ANALYSIS</span><h3>Lecturas rápidas</h3></div><Activity size={17} /></div>
            <div className="slx-intel-list">
              <div><span>TOP PRODUCT</span><b>{data.topProduct}</b><small>Mayor rotación detectada hoy.</small></div>
              <div><span>LAST SALE</span><b>{latest ? shortMoney(latest.total) : '—'}</b><small>{latest ? `${latest.userName} · ${time.format(new Date(latest.createdAt))}` : 'Sin ventas todavía.'}</small></div>
              <div><span>ORDER QUEUE</span><b>{data.pendingOrders} abiertas</b><small>{data.pendingOrders ? 'MAICOL mantiene seguimiento.' : 'Cola operativa despejada.'}</small></div>
            </div>
          </section>
        </div>

        <div className="slx-grid-two slx-lower-grid">
          <section className="slx-panel">
            <div className="slx-panel-head"><div><span className="slx-kicker">CORE MONITOR</span><h3>Environment status</h3></div><span className="slx-status-ok">ALL SYSTEMS NOMINAL</span></div>
            <div className="slx-monitor-grid">
              {[
                ['LOCAL DATABASE', 'SYNCED', Database],
                ['PWA SHELL', 'ONLINE', Wifi],
                ['POS SESSION', 'ACTIVE', Activity],
                ['CLIENT NODE', 'CONNECTED', UsersRound],
              ].map(([label, value, Icon]) => { const I = Icon as typeof Database; return <div key={String(label)}><I size={15} /><span><b>{label}</b><small>{value}</small></span><i className="slx-check"><ShieldCheck size={13} /></i></div> })}
            </div>
          </section>

          <section className="slx-panel slx-sensitive-panel">
            <div className="slx-panel-head"><div><span className="slx-kicker">RESTRICTED DATA</span><h3>Business dossier</h3></div><KeyRound size={17} /></div>
            <div className="slx-dossier"><div><span>CLIENT</span><b>Smaky</b></div><div><span>ACTIVE USERS</span><b>{data.users}</b></div><div><span>PRODUCT CATALOG</span><b>{products.length}</b></div><div><span>LAST SYNC</span><b>{time.format(clock)}</b></div></div>
            <button onClick={() => setShowVault(true)} className="slx-vault-open"><LockKeyhole size={14} /> Abrir secure vault <ArrowRightSmall /></button>
          </section>
        </div>
      </section>

      <footer className="slx-core-footer"><span>STREAMLINX CORE v0.1</span><span>PRIVATE ACCESS ONLY</span><span>NODE HASH <b>8F-01-AX</b></span></footer>
    </main>

    {showVault && <VaultModal onClose={() => setShowVault(false)} />}
  </div>
}

function ArrowRightSmall() { return <span className="slx-arrow-small">↗</span> }

function VaultModal({ onClose }: { onClose: () => void }) {
  const [reveal, setReveal] = useState(false)
  const rows = [
    ['POS MASTER', '••••••••••••', 'LOCAL / PROTECTED'],
    ['DATABASE', '••••••••••••', 'ENVIRONMENT LOCKED'],
    ['HOSTING', '••••••••••••', 'PRIVATE CONFIG'],
    ['BUSINESS NOTES', '••••••••••••', 'RESTRICTED'],
  ]

  return <div className="slx-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="slx-vault-modal">
      <div className="slx-vault-header"><div><span className="slx-kicker">STREAMLINX // SECURE VAULT</span><h2>Credenciales & datos críticos</h2></div><button onClick={onClose}><X size={16} /></button></div>
      <div className="slx-vault-warning"><ShieldCheck size={15} /><span>Las credenciales reales no se almacenan en la interfaz. Este vault representa la capa reservada para integraciones seguras posteriores.</span></div>
      <div className="slx-vault-list">{rows.map(([name, value, status]) => <div key={name} className="slx-vault-row"><div className="slx-vault-icon"><KeyRound size={15} /></div><div><b>{name}</b><small>{status}</small></div><strong>{reveal ? 'PROTECTED' : value}</strong></div>)}</div>
      <div className="slx-vault-actions"><button onClick={() => setReveal(value => !value)}>{reveal ? <EyeOff size={14} /> : <Eye size={14} />}{reveal ? 'Hide' : 'Inspect'} masked data</button><button className="slx-vault-close" onClick={onClose}>Close vault</button></div>
    </div>
  </div>
}
