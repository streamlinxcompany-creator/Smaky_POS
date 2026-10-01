import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, Archive, ArchiveRestore, ArrowRight, BarChart3, Boxes, Check, ChevronRight,
  CircleDollarSign, ClipboardList, Command, Database, FileArchive, Fingerprint, Gauge,
  HardDrive, KeyRound, LayoutDashboard, LockKeyhole, LogOut, Package, Pencil, RefreshCw, RotateCcw,
  Search, ServerCog, ShieldAlert, ShieldCheck, Terminal, Trash2, Users, WalletCards, X
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getSessionUser } from '../lib/auth'
import {
  getAllProducts, getOrders, getSales, getUsers, getClosures, saveProduct, deleteProduct,
  deleteOrder, deleteSale, updateOrderStatus, updateUserSettings, resetTestData
} from '../lib/store'
import { db } from '../lib/db'
import { money } from '../lib/format'
import type { CashClosure, Order, OrderStatus, Product, Sale, User } from '../lib/types'

const moneyFmt = (value: number) => money(Math.round(Number(value) || 0))
const roleLabel = (role: User['role']) => role === 'manager' ? 'Gerente' : role === 'admin' ? 'Administrador' : 'Trabajador'
const paymentLabel = (payment: Sale['payment']) => payment === 'cash' ? 'Efectivo' : payment === 'transfer' ? 'Transferencia' : 'Tarjeta'
const statusLabel: Record<OrderStatus, string> = {
  pending: 'Pendiente', preparing: 'Preparando', ready: 'Listo', delivered: 'Entregado', paid: 'Pagado', cancelled: 'Cancelado'
}
const formatDateTime = (iso: string) => new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))

const tabs = [
  { id: 'command', label: 'Comando', icon: LayoutDashboard },
  { id: 'sales', label: 'Ventas', icon: CircleDollarSign },
  { id: 'products', label: 'Productos', icon: Package },
  { id: 'orders', label: 'Pedidos', icon: ClipboardList },
  { id: 'users', label: 'Personal', icon: Users },
  { id: 'closures', label: 'Cierres', icon: LockKeyhole },
  { id: 'system', label: 'Sistema', icon: ServerCog },
] as const

type TabId = typeof tabs[number]['id']
type ConfirmAction =
  | { kind: 'sale'; id: string; title: string; detail: string }
  | { kind: 'product'; id: string; title: string; detail: string }
  | { kind: 'order'; id: string; title: string; detail: string }
  | { kind: 'closure'; id: string; title: string; detail: string }
  | { kind: 'reset'; id: string; title: string; detail: string }
  | null

type ProductForm = { name: string; category: Product['category']; price: string; active: boolean }

const auditKey = 'streamlinx-command-audit'
function readAudit() {
  try { return JSON.parse(localStorage.getItem(auditKey) || '[]') as { at: string; actor: string; action: string; detail: string }[] } catch { return [] }
}
function addAudit(actor: string, action: string, detail: string) {
  const next = [{ at: new Date().toISOString(), actor, action, detail }, ...readAudit()].slice(0, 40)
  localStorage.setItem(auditKey, JSON.stringify(next))
}

export function StreamLinx() {
  const navigate = useNavigate()
  const [clock, setClock] = useState(new Date())
  const [booted, setBooted] = useState(false)
  const [tab, setTab] = useState<TabId>('command')
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [closures, setClosures] = useState<CashClosure[]>([])
  const [search, setSearch] = useState('')
  const [managerVerified, setManagerVerified] = useState(getSessionUser()?.role === 'manager')
  const [managerPin, setManagerPin] = useState('')
  const [managerError, setManagerError] = useState('')
  const [managerGateOpen, setManagerGateOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [productForm, setProductForm] = useState<ProductForm>({ name: '', category: 'Hamburguesas', price: '', active: true })
  const [productError, setProductError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(true)
  const [lastSync, setLastSync] = useState<Date | null>(null)

  const currentSession = getSessionUser()
  const actor = managerVerified ? (users.find(u => u.role === 'manager' && u.active) || currentSession) : currentSession

  const loadData = async () => {
    setLoading(true)
    try {
      const [nextProducts, nextSales, nextOrders, nextUsers, nextClosures] = await Promise.all([
        getAllProducts(), getSales(), getOrders(), getUsers(), getClosures()
      ])
      setProducts(nextProducts)
      setSales(nextSales)
      setOrders(nextOrders)
      setUsers(nextUsers)
      setClosures(nextClosures)
      setLastSync(new Date())
    } finally { setLoading(false) }
  }

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    const boot = window.setTimeout(() => setBooted(true), 750)
    void loadData()
    return () => { window.clearInterval(timer); window.clearTimeout(boot) }
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const totals = useMemo(() => {
    const totalSales = sales.reduce((sum, sale) => sum + sale.total, 0)
    const cash = sales.filter(s => s.payment === 'cash').reduce((sum, sale) => sum + sale.total, 0)
    const transfer = sales.filter(s => s.payment === 'transfer').reduce((sum, sale) => sum + sale.total, 0)
    const card = sales.filter(s => s.payment === 'card').reduce((sum, sale) => sum + sale.total, 0)
    return { totalSales, cash, transfer, card }
  }, [sales])

  const todaySales = useMemo(() => {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    return sales.filter(sale => (sale.businessDateKey || sale.createdAt.slice(0, 10)) === key)
  }, [sales])

  const operationalTotals = useMemo(() => {
    const value = todaySales.reduce((sum, sale) => sum + sale.total, 0)
    const avg = todaySales.length ? value / todaySales.length : 0
    return { value, avg }
  }, [todaySales])

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sales
    return sales.filter(sale => [sale.customerName, sale.userName, sale.orderNumber?.toString(), sale.id, paymentLabel(sale.payment)].join(' ').toLowerCase().includes(q))
  }, [sales, search])

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(product => [product.name, product.category].join(' ').toLowerCase().includes(q))
  }, [products, search])

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return orders
    return orders.filter(order => [order.customerName, order.userName, order.orderNumber, order.phone, statusLabel[order.status]].join(' ').toLowerCase().includes(q))
  }, [orders, search])

  const date = useMemo(() => new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: '2-digit', month: 'long' }).format(clock), [clock])
  const time = useMemo(() => new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(clock), [clock])

  const requireManager = () => {
    if (managerVerified) return true
    setManagerGateOpen(true)
    setManagerPin('')
    setManagerError('')
    return false
  }

  const verifyManager = async () => {
    const manager = (await getUsers()).find(user => user.role === 'manager' && user.active && user.pin === managerPin)
    if (!manager) {
      setManagerError('CREDENCIAL DE GERENTE NO VÁLIDA')
      return
    }
    setManagerVerified(true)
    setManagerGateOpen(false)
    setManagerPin('')
    addAudit(manager.name, 'ACCESO DE MANDO', 'Verificación de gerente concedida')
    setToast(`Control de mando concedido · ${manager.name}`)
  }

  const openEditProduct = (product: Product) => {
    if (!requireManager()) return
    setEditingProduct(product)
    setProductForm({ name: product.name, category: product.category, price: String(product.price), active: product.active })
    setProductError('')
  }

  const saveProductChanges = async () => {
    if (!editingProduct || !requireManager()) return
    const name = productForm.name.trim()
    const price = Number(productForm.price)
    if (!name || !Number.isFinite(price) || price <= 0) {
      setProductError('Nombre y precio válido son obligatorios.')
      return
    }
    setSaving(true)
    try {
      await saveProduct({ ...editingProduct, name, price: Math.round(price), category: productForm.category, active: productForm.active })
      addAudit(actor?.name || 'Gerente', 'PRODUCTO ACTUALIZADO', `${name} · ${moneyFmt(price)}`)
      setEditingProduct(null)
      await loadData()
      setToast('Producto actualizado')
    } finally { setSaving(false) }
  }

  const runConfirmedAction = async () => {
    if (!confirmAction || !requireManager()) return
    const action = confirmAction
    setSaving(true)
    try {
      if (action.kind === 'sale') {
        const ok = actor?.id ? await deleteSale(action.id, actor.id) : false
        if (!ok) throw new Error('No fue posible eliminar la venta.')
        addAudit(actor?.name || 'Gerente', 'VENTA ELIMINADA', action.detail)
      }
      if (action.kind === 'product') {
        const ok = actor?.id ? await deleteProduct(action.id, actor.id) : false
        if (!ok) throw new Error('No fue posible eliminar el producto.')
        addAudit(actor?.name || 'Gerente', 'PRODUCTO ELIMINADO', action.detail)
      }
      if (action.kind === 'order') {
        const ok = actor?.id ? await deleteOrder(action.id, actor.id) : false
        if (!ok) throw new Error('Solo se pueden borrar pedidos no pagados.')
        addAudit(actor?.name || 'Gerente', 'PEDIDO ELIMINADO', action.detail)
      }
      if (action.kind === 'closure') {
        const { deletePreviousDayClosure } = await import('../lib/store')
        const ok = actor?.id ? await deletePreviousDayClosure(action.id, actor) : false
        if (!ok) throw new Error('Solo se puede borrar el cierre del día anterior.')
        addAudit(actor?.name || 'Gerente', 'CIERRE ELIMINADO', action.detail)
      }
      if (action.kind === 'reset') {
        const ok = actor ? await resetTestData(actor) : false
        if (!ok) throw new Error('No fue posible reiniciar los datos de prueba.')
        addAudit(actor?.name || 'Gerente', 'RESET OPERATIVO', 'Ventas, pedidos y cierres eliminados')
      }
      setConfirmAction(null)
      await loadData()
      setToast('Operación completada')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Operación no completada')
    } finally { setSaving(false) }
  }

  const exportBackup = async () => {
    if (!requireManager()) return
    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'Smaky POS',
      version: '0.14.0',
      products: await db.products.toArray(),
      sales: await db.sales.toArray(),
      orders: await db.orders.toArray(),
      users: await db.users.toArray(),
      closures: await db.closures.toArray(),
      audit: readAudit()
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `smaky-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
    addAudit(actor?.name || 'Gerente', 'BACKUP EXPORTADO', 'Copia completa de la base local')
    setToast('Backup generado')
  }

  const audit = readAudit()

  if (!booted) {
    return <div className="slx-boot"><div className="slx-boot-orbit"/><img src="/Streamlinx.png" alt="StreamLinx" onError={event => { event.currentTarget.style.display = 'none' }} /><div className="slx-boot-word">STREAMLINX</div><div className="slx-boot-status"><span/> INICIANDO NÚCLEO DE MANDO</div></div>
  }

  return <div className="slx-shell slx-command-shell">
    <aside className="slx-sidebar slx-command-sidebar">
      <div className="slx-brand"><div className="slx-logo-wrap"><img src="/Streamlinx.png" alt="StreamLinx" onError={event => { event.currentTarget.style.display = 'none' }} /><span>S</span></div><div><b>StreamLinx</b><small>COMMAND CORE</small></div></div>
      <div className={`slx-access ${managerVerified ? 'slx-access-manager' : ''}`}><span className="slx-pulse"/> {managerVerified ? 'CONTROL DE MANDO' : 'ACCESO INTERNO'} <b>{managerVerified ? 'GERENTE' : 'LEVEL 04'}</b></div>
      <nav>{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setSearch('') }}><Icon size={15}/>{label}</button>)}</nav>
      <div className="slx-sidebar-bottom">
        <div className="slx-terminal-mini"><Terminal size={14}/><div><b>SMaky DB</b><span>{loading ? 'Sincronizando...' : 'Base local operativa'}</span></div><i/></div>
        <button onClick={() => navigate('/login')}><LogOut size={14}/> Salir del centro</button>
      </div>
    </aside>

    <main className="slx-main">
      <header className="slx-topbar"><div><span className="slx-kicker">COMMAND CENTER</span><span className="slx-separator">/</span><span className="slx-muted">SMaky POS // CONTROL DE DATOS</span></div><div className="slx-top-right"><span>{date}</span><strong>{time}</strong></div></header>

      <section className="slx-content slx-command-content">
        <div className="slx-command-head">
          <div><div className="slx-kicker">STREAMLINX // PRIVILEGED OPERATIONS</div><h1>Alto mando.</h1><p>El núcleo de control de Smaky: lectura de operación, cambios sensibles, auditoría y herramientas de recuperación.</p></div>
          <div className="slx-command-badge"><ShieldCheck size={17}/><div><b>{managerVerified ? 'MANAGER VERIFIED' : 'READ ONLY'}</b><span>{managerVerified ? 'Privilegios destructivos habilitados' : 'Verifica gerente para modificar datos'}</span></div></div>
        </div>

        <div className="slx-command-strip">
          <div><span>VENTAS HOY</span><b>{moneyFmt(operationalTotals.value)}</b><small>{todaySales.length} transacciones</small></div>
          <div><span>PROMEDIO TICKET</span><b>{moneyFmt(operationalTotals.avg)}</b><small>por venta</small></div>
          <div><span>PRODUCTOS</span><b>{products.filter(p => p.active).length}</b><small>activos / {products.length} total</small></div>
          <div><span>PERSONAL</span><b>{users.filter(u => u.active).length}</b><small>cuentas activas</small></div>
          <div><span>ESTADO DB</span><b className="ok">ONLINE</b><small>{lastSync ? `sync ${lastSync.toLocaleTimeString('es-CO')}` : 'sincronizando'}</small></div>
        </div>

        {tab !== 'command' && <div className="slx-toolbar-command"><div><b>{tabs.find(item => item.id === tab)?.label}</b><span> / DATA CONTROL</span></div><div className="slx-toolbar-actions"><div className="slx-command-search"><Search size={14}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar en el núcleo..." /></div><button className="slx-ghost-btn" onClick={() => void loadData()}><RefreshCw size={14}/> Sincronizar</button></div></div>}

        {tab === 'command' && <CommandDashboard managerVerified={managerVerified} products={products} sales={sales} orders={orders} users={users} closures={closures} audit={audit} onTab={setTab} onManager={() => requireManager()} exportBackup={exportBackup} />}

        {tab === 'sales' && <section className="slx-data-panel"><div className="slx-panel-head"><div><span className="slx-kicker">LEDGER</span><h2>Ventas registradas</h2></div><span>{filteredSales.length} registros</span></div><div className="slx-data-table-wrap"><table className="slx-data-table"><thead><tr><th>Fecha</th><th>Pedido</th><th>Cliente</th><th>Usuario</th><th>Método</th><th>Total</th><th></th></tr></thead><tbody>{filteredSales.map(sale => <tr key={sale.id}><td>{formatDateTime(sale.createdAt)}</td><td><b>{sale.orderNumber ? `#${sale.orderNumber}` : 'Venta'}</b></td><td>{sale.customerName || 'Mostrador'}</td><td>{sale.userName}</td><td><span className="slx-chip">{paymentLabel(sale.payment)}</span></td><td><b>{moneyFmt(sale.total)}</b></td><td><button className="slx-row-danger" onClick={() => setConfirmAction({ kind: 'sale', id: sale.id, title: 'Eliminar venta', detail: `${sale.orderNumber ? `Pedido #${sale.orderNumber}` : sale.id} · ${moneyFmt(sale.total)}` })}><Trash2 size={14}/></button></td></tr>)}</tbody></table>{filteredSales.length === 0 && <EmptyState icon={CircleDollarSign} text="No hay ventas que coincidan."/>}</div></section>}

        {tab === 'products' && <section className="slx-data-panel"><div className="slx-panel-head"><div><span className="slx-kicker">CATALOG CONTROL</span><h2>Productos</h2></div><span>{filteredProducts.length} registros</span></div><div className="slx-data-table-wrap"><table className="slx-data-table"><thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Estado</th><th></th></tr></thead><tbody>{filteredProducts.map(product => <tr key={product.id}><td><b>{product.name}</b><small>{product.id}</small></td><td>{product.category}</td><td><b>{moneyFmt(product.price)}</b></td><td><span className={`slx-chip ${product.active ? 'positive' : 'muted'}`}>{product.active ? 'Activo' : 'Inactivo'}</span></td><td><div className="slx-row-actions"><button className="slx-row-btn" onClick={() => openEditProduct(product)}><Pencil size={14}/></button><button className="slx-row-btn" onClick={() => { if (!requireManager()) return; void saveProduct({ ...product, active: !product.active }).then(() => { addAudit(actor?.name || 'Gerente', product.active ? 'PRODUCTO DESACTIVADO' : 'PRODUCTO ACTIVADO', product.name); void loadData(); setToast(product.active ? 'Producto desactivado' : 'Producto activado') }) }}>{product.active ? <Archive size={14}/> : <ArchiveRestore size={14}/>}</button><button className="slx-row-danger" onClick={() => setConfirmAction({ kind: 'product', id: product.id, title: 'Eliminar producto', detail: `${product.name} · ${moneyFmt(product.price)}` })}><Trash2 size={14}/></button></div></td></tr>)}</tbody></table>{filteredProducts.length === 0 && <EmptyState icon={Package} text="No hay productos que coincidan."/>}</div></section>}

        {tab === 'orders' && <section className="slx-data-panel"><div className="slx-panel-head"><div><span className="slx-kicker">FULFILLMENT CONTROL</span><h2>Pedidos</h2></div><span>{filteredOrders.length} registros</span></div><div className="slx-data-table-wrap"><table className="slx-data-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Creado</th><th>Usuario</th><th>Estado</th><th>Total</th><th></th></tr></thead><tbody>{filteredOrders.map(order => <tr key={order.id}><td><b>#{order.orderNumber}</b></td><td>{order.customerName || 'Mostrador'}<small>{order.phone}</small></td><td>{formatDateTime(order.createdAt)}</td><td>{order.userName}</td><td><select className="slx-status-select" value={order.status} disabled={['paid','cancelled'].includes(order.status)} onChange={event => void updateOrderStatus(order.id, event.target.value as OrderStatus).then(() => { addAudit(actor?.name || currentSession?.name || 'Operador', 'PEDIDO ACTUALIZADO', `#${order.orderNumber} → ${statusLabel[event.target.value as OrderStatus]}`); void loadData(); setToast('Estado actualizado') })}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td><td><b>{moneyFmt(order.total)}</b></td><td><button className="slx-row-danger" disabled={['paid','cancelled'].includes(order.status)} onClick={() => setConfirmAction({ kind: 'order', id: order.id, title: 'Eliminar pedido', detail: `#${order.orderNumber} · ${order.customerName || 'Mostrador'} · ${moneyFmt(order.total)}` })}><Trash2 size={14}/></button></td></tr>)}</tbody></table>{filteredOrders.length === 0 && <EmptyState icon={ClipboardList} text="No hay pedidos que coincidan."/>}</div></section>}

        {tab === 'users' && <UsersControl users={users} managerVerified={managerVerified} onManager={requireManager} onReload={loadData} onToast={setToast} actor={actor || currentSession}/>} 

        {tab === 'closures' && <ClosuresControl closures={closures} managerVerified={managerVerified} onManager={requireManager} onDelete={setConfirmAction} />}

        {tab === 'system' && <SystemControl managerVerified={managerVerified} onManager={requireManager} exportBackup={exportBackup} onReset={() => setConfirmAction({ kind: 'reset', id: 'reset', title: 'Restablecer datos operativos', detail: 'Se borrarán ventas, pedidos y cierres. Productos y perfiles se conservan.' })} audit={audit} />}
      </section>
    </main>

    {toast && <div className="slx-toast"><Check size={14}/>{toast}</div>}

    {managerGateOpen && <div className="slx-cmd-overlay"><div className="slx-manager-modal"><button className="slx-v2-close" onClick={() => setManagerGateOpen(false)} aria-label="Cerrar"><X size={15}/></button><div className="slx-manager-icon"><Fingerprint size={24}/></div><span className="slx-kicker">LEVEL 05 // COMMAND AUTHORITY</span><h2>Verificación de Gerente</h2><p>Esta capa habilita cambios, eliminaciones, backup y acciones de recuperación sobre los datos de Smaky.</p><label>PIN DE GERENTE<input autoFocus type="password" inputMode="numeric" maxLength={4} value={managerPin} onChange={event => { setManagerPin(event.target.value.replace(/\D/g,'').slice(0,4)); setManagerError('') }} onKeyDown={event => event.key === 'Enter' && void verifyManager()} placeholder="••••" /></label>{managerError && <div className="slx-manager-error"><ShieldAlert size={14}/>{managerError}</div>}<button className="slx-command-primary" disabled={managerPin.length !== 4} onClick={() => void verifyManager()}><KeyRound size={15}/> AUTORIZAR CONTROL DE MANDO <ArrowRight size={15}/></button><span className="slx-manager-foot">Toda acción sensible queda registrada en la auditoría local.</span></div></div>}

    {editingProduct && <div className="slx-cmd-overlay"><div className="slx-manager-modal slx-product-modal"><button className="slx-v2-close" onClick={() => !saving && setEditingProduct(null)} aria-label="Cerrar"><X size={15}/></button><span className="slx-kicker">CATALOG CONTROL</span><h2>Editar producto</h2><div className="slx-product-preview"><div><b>{productForm.name || 'Nuevo producto'}</b><span>{productForm.category}</span></div><strong>{moneyFmt(Number(productForm.price))}</strong></div><label>Nombre<input autoFocus value={productForm.name} onChange={event => setProductForm(form => ({ ...form, name: event.target.value }))}/></label><div className="slx-form-grid"><label>Categoría<select value={productForm.category} onChange={event => setProductForm(form => ({ ...form, category: event.target.value as Product['category'] }))}>{['Hamburguesas','Combos','Acompañamientos','Bebidas'].map(category => <option key={category}>{category}</option>)}</select></label><label>Precio<input type="number" value={productForm.price} onChange={event => setProductForm(form => ({ ...form, price: event.target.value }))}/></label></div><label className="slx-check-line"><input type="checkbox" checked={productForm.active} onChange={event => setProductForm(form => ({ ...form, active: event.target.checked }))}/><span>Disponible en POS</span></label>{productError && <div className="slx-manager-error"><AlertTriangle size={14}/>{productError}</div>}<button className="slx-command-primary" disabled={saving} onClick={() => void saveProductChanges()}><Check size={15}/>{saving ? 'GUARDANDO…' : 'GUARDAR CAMBIOS'}</button></div></div>}

    {confirmAction && <div className="slx-cmd-overlay"><div className="slx-confirm-modal"><div className="slx-confirm-icon"><AlertTriangle size={22}/></div><span className="slx-kicker">HIGH RISK OPERATION</span><h2>{confirmAction.title}</h2><p>{confirmAction.detail}</p><div className="slx-confirm-warning">Esta acción modifica datos reales de la base local de Smaky y no se puede deshacer desde este panel.</div><div className="slx-confirm-actions"><button className="slx-ghost-btn" onClick={() => setConfirmAction(null)}>Cancelar</button><button className="slx-danger-btn" disabled={saving} onClick={() => void runConfirmedAction()}><Trash2 size={14}/>{saving ? 'EJECUTANDO…' : 'CONFIRMAR'}</button></div></div></div>}
  </div>
}

function CommandDashboard({ managerVerified, products, sales, orders, users, closures, audit, onTab, onManager, exportBackup, }: { managerVerified: boolean; products: Product[]; sales: Sale[]; orders: Order[]; users: User[]; closures: CashClosure[]; audit: { at: string; actor: string; action: string; detail: string }[]; onTab: (id: TabId) => void; onManager: () => void; exportBackup: () => Promise<void> }) {
  const activeUsers = users.filter(u => u.active)
  const openOrders = orders.filter(o => !['paid','cancelled'].includes(o.status))
  const activeProducts = products.filter(p => p.active)
  const recent = [...audit].slice(0, 6)
  return <div className="slx-command-grid">
    <div className="slx-command-hero-panel"><div className="slx-command-hero-icon"><Gauge size={19}/></div><div><span className="slx-kicker">CONTROL STATUS</span><h2>{managerVerified ? 'Sistema bajo control de Gerencia' : 'Modo de observación operativo'}</h2><p>{managerVerified ? 'Puedes intervenir directamente sobre catálogos, pedidos, perfiles, cierres y recuperación.' : 'La información es visible. Las operaciones de riesgo requieren una segunda autenticación.'}</p></div>{!managerVerified && <button className="slx-command-primary small" onClick={onManager}>Verificar Gerente <ChevronRight size={15}/></button>}</div>
    <QuickCard title="Ventas" value={sales.length.toString()} detail="Historial completo" icon={CircleDollarSign} onClick={() => onTab('sales')}/>
    <QuickCard title="Catálogo" value={activeProducts.length.toString()} detail={`${products.length - activeProducts.length} inactivos`} icon={Package} onClick={() => onTab('products')}/>
    <QuickCard title="Pedidos" value={openOrders.length.toString()} detail="En flujo operativo" icon={ClipboardList} onClick={() => onTab('orders')}/>
    <QuickCard title="Personal" value={activeUsers.length.toString()} detail={`${users.length} perfiles`} icon={Users} onClick={() => onTab('users')}/>
    <div className="slx-command-wide"><div className="slx-command-wide-head"><div><span className="slx-kicker">RECENT ACTIVITY</span><h3>Registro de mando</h3></div><span>{recent.length ? 'AUDITORÍA LOCAL' : 'SIN EVENTOS'}</span></div>{recent.length ? <div className="slx-audit-list">{recent.map((item, index) => <div className="slx-audit-row" key={`${item.at}-${index}`}><span>{new Date(item.at).toLocaleTimeString('es-CO')}</span><b>{item.action}</b><em>{item.actor}</em><small>{item.detail}</small></div>)}</div> : <EmptyState icon={Activity} text="Todavía no hay acciones registradas por el centro."/>}</div>
    <div className="slx-command-wide slx-command-actions-panel"><div className="slx-command-wide-head"><div><span className="slx-kicker">EXECUTIVE ACTIONS</span><h3>Herramientas del alto mando</h3></div><ShieldCheck size={16}/></div><div className="slx-exec-grid"><ExecutiveAction icon={FileArchive} title="Backup completo" detail="Exporta toda la base local a JSON" locked={!managerVerified} onClick={() => void exportBackup()}/><ExecutiveAction icon={WalletCards} title="Cierres de caja" detail="Revisión y correcciones de cierres" locked={false} onClick={() => onTab('closures')}/><ExecutiveAction icon={HardDrive} title="Integridad" detail="Catálogo, ventas, pedidos y usuarios" locked={false} onClick={() => onTab('system')}/><ExecutiveAction icon={ShieldAlert} title="Control de usuarios" detail="Perfiles y permisos administrativos" locked={!managerVerified} onClick={() => onTab('users')}/></div></div>
    <div className="slx-command-mini-panel"><Terminal size={15}/><div><span className="slx-kicker">CORE TELEMETRY</span><b>Dexie / IndexedDB</b><small>{products.length + sales.length + orders.length + users.length + closures.length} registros en memoria operacional</small></div><i className="live"/></div>
    <div className="slx-command-mini-panel"><LockKeyhole size={15}/><div><span className="slx-kicker">PRIVILEGE MODEL</span><b>{managerVerified ? 'LEVEL 05 / MANAGER' : 'LEVEL 04 / INTERNAL'}</b><small>{managerVerified ? 'Edición y acciones destructivas habilitadas' : 'Consulta habilitada · mutaciones bloqueadas'}</small></div></div>
  </div>
}

function QuickCard({ title, value, detail, icon: Icon, onClick }: { title: string; value: string; detail: string; icon: typeof Activity; onClick: () => void }) {
  return <button className="slx-command-card" onClick={onClick}><div className="slx-command-card-icon"><Icon size={17}/></div><div><span>{title}</span><b>{value}</b><small>{detail}</small></div><ArrowRight size={14}/></button>
}

function ExecutiveAction({ icon: Icon, title, detail, locked, onClick }: { icon: typeof Activity; title: string; detail: string; locked: boolean; onClick: () => void }) {
  return <button className={`slx-exec-action ${locked ? 'locked' : ''}`} onClick={onClick}><div><Icon size={16}/></div><span><b>{title}</b><small>{detail}</small></span>{locked ? <LockKeyhole size={13}/> : <ArrowRight size={13}/>}</button>
}

function EmptyState({ icon: Icon, text }: { icon: typeof Activity; text: string }) { return <div className="slx-empty"><Icon size={25}/><b>{text}</b></div> }

function UsersControl({ users, managerVerified, onManager, onReload, onToast, actor }: { users: User[]; managerVerified: boolean; onManager: () => void; onReload: () => Promise<void>; onToast: (value: string) => void; actor: User | null }) {
  const [selected, setSelected] = useState<User | null>(null)
  const [form, setForm] = useState({ name: '', pin: '', rank: '', role: 'employee' as User['role'], active: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const open = (user: User) => { if (!managerVerified) { onManager(); return }; setSelected(user); setForm({ name: user.name, pin: user.pin, rank: user.rank, role: user.role, active: user.active }); setError('') }
  const save = async () => { if (!selected || !actor || !managerVerified) return; setSaving(true); try { const result = await updateUserSettings(selected.id, form, actor.id); if (!result) throw new Error('No fue posible actualizar el perfil.'); localStorage.setItem('streamlinx-command-audit', JSON.stringify([{ at: new Date().toISOString(), actor: actor.name, action: 'USUARIO ACTUALIZADO', detail: `${form.name} · ${roleLabel(form.role)}` }, ...readAudit()].slice(0, 40))); setSelected(null); await onReload(); onToast('Perfil actualizado') } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.') } finally { setSaving(false) } }
  return <section className="slx-data-panel"><div className="slx-panel-head"><div><span className="slx-kicker">IDENTITY CONTROL</span><h2>Personal y permisos</h2></div><span>{users.length} perfiles</span></div><div className="slx-user-card-grid">{users.map(user => <div className={`slx-user-command-card ${!user.active ? 'off' : ''}`} key={user.id}><div className="slx-user-command-avatar">{user.name.slice(0,2).toUpperCase()}</div><div className="slx-user-command-info"><b>{user.name}</b><span>{user.rank || roleLabel(user.role)}</span><em>{roleLabel(user.role)} · {user.active ? 'ACTIVO' : 'INACTIVO'}</em></div><button className="slx-row-btn" onClick={() => open(user)}><Pencil size={14}/></button></div>)}</div>{!managerVerified && <div className="slx-lock-banner"><LockKeyhole size={16}/><div><b>Control protegido por Gerente</b><span>La consulta está disponible; editar permisos requiere verificación.</span></div><button className="slx-command-primary small" onClick={onManager}>Autorizar</button></div>}{selected && <div className="slx-cmd-overlay"><div className="slx-manager-modal slx-product-modal"><button className="slx-v2-close" onClick={() => !saving && setSelected(null)} aria-label="Cerrar"><X size={15}/></button><span className="slx-kicker">IDENTITY CONTROL</span><h2>Editar perfil</h2><label>Nombre<input value={form.name} onChange={event => setForm(v => ({ ...v, name: event.target.value }))}/></label><div className="slx-form-grid"><label>PIN<input inputMode="numeric" maxLength={4} value={form.pin} onChange={event => setForm(v => ({ ...v, pin: event.target.value.replace(/\D/g,'').slice(0,4) }))}/></label><label>Rango<input value={form.rank} onChange={event => setForm(v => ({ ...v, rank: event.target.value }))}/></label></div><label>Rol<select value={form.role} onChange={event => setForm(v => ({ ...v, role: event.target.value as User['role'] }))} disabled={selected.role === 'manager'}><option value="employee">Trabajador</option><option value="admin">Administrador</option></select></label><label className="slx-check-line"><input type="checkbox" checked={form.active} onChange={event => setForm(v => ({ ...v, active: event.target.checked }))} disabled={selected.role === 'manager' || selected.id === actor?.id}/><span>Cuenta activa</span></label>{error && <div className="slx-manager-error"><AlertTriangle size={14}/>{error}</div>}<button className="slx-command-primary" disabled={saving} onClick={() => void save()}><Check size={15}/>{saving ? 'GUARDANDO…' : 'GUARDAR PERFIL'}</button></div></div>}</section>
}

function ClosuresControl({ closures, managerVerified, onManager, onDelete }: { closures: CashClosure[]; managerVerified: boolean; onManager: () => void; onDelete: (value: ConfirmAction) => void }) {
  return <section className="slx-data-panel"><div className="slx-panel-head"><div><span className="slx-kicker">CASH CONTROL</span><h2>Cierres registrados</h2></div><span>{closures.length} cierres</span></div><div className="slx-closure-list">{closures.map(closure => <div className="slx-closure-row" key={closure.id}><div><span className="slx-kicker">{closure.dateKey}</span><b>{moneyFmt(closure.total)}</b><small>{closure.saleCount} ventas · {closure.userName}</small></div><div className={`slx-diff ${closure.cashDifference < 0 ? 'negative' : closure.cashDifference > 0 ? 'positive' : ''}`}>EFECTIVO {moneyFmt(closure.cashDifference)}</div><button className="slx-row-danger" disabled={!managerVerified} title="Solo permite borrar el cierre del día anterior" onClick={() => { if (!managerVerified) return onManager(); onDelete({ kind: 'closure', id: closure.id, title: 'Eliminar cierre de caja', detail: `${closure.dateKey} · ${moneyFmt(closure.total)}` }) }}><Trash2 size={14}/></button></div>)}{closures.length === 0 && <EmptyState icon={LockKeyhole} text="No hay cierres registrados."/>}</div><div className="slx-info-note"><ShieldCheck size={15}/><span>La lógica del sistema solo permite eliminar mediante esta acción el cierre del día anterior. Los demás permanecen protegidos.</span></div></section>
}

function SystemControl({ managerVerified, onManager, exportBackup, onReset, audit }: { managerVerified: boolean; onManager: () => void; exportBackup: () => Promise<void>; onReset: () => void; audit: { at: string; actor: string; action: string; detail: string }[] }) {
  const checks = [
    { label: 'Base IndexedDB', value: 'ONLINE', icon: Database },
    { label: 'Capa de identidad', value: 'ACTIVE', icon: Fingerprint },
    { label: 'Catálogo Smaky', value: 'AVAILABLE', icon: Boxes },
    { label: 'Ledger de ventas', value: 'AVAILABLE', icon: BarChart3 },
    { label: 'Módulo de pedidos', value: 'AVAILABLE', icon: ClipboardList },
    { label: 'Cierres de caja', value: 'AVAILABLE', icon: WalletCards },
  ]
  return <section className="slx-data-panel"><div className="slx-panel-head"><div><span className="slx-kicker">SYSTEM INTEGRITY</span><h2>Infraestructura</h2></div><span>LOCAL CORE</span></div><div className="slx-system-grid">{checks.map(({ label, value, icon: Icon }) => <div className="slx-system-check" key={label}><Icon size={15}/><div><b>{label}</b><span>{value}</span></div><i/></div>)}</div><div className="slx-danger-zone"><div><span className="slx-kicker">RECOVERY // HIGH RISK</span><h3>Acciones irreversibles</h3><p>Estas funciones están separadas del flujo normal para evitar accidentes. Productos y perfiles no se eliminan con el reset de pruebas.</p></div><div className="slx-danger-actions"><button className="slx-danger-btn" onClick={() => managerVerified ? void exportBackup() : onManager()}><FileArchive size={14}/> {managerVerified ? 'Exportar backup' : 'Autorizar backup'}</button><button className="slx-danger-btn" onClick={() => managerVerified ? onReset() : onManager()}><RotateCcw size={14}/> Reset de pruebas</button></div></div><div className="slx-audit-large"><div className="slx-command-wide-head"><div><span className="slx-kicker">AUDIT</span><h3>Últimas acciones</h3></div><span>{audit.length} eventos</span></div>{audit.length ? audit.slice(0, 12).map((item, index) => <div className="slx-audit-row" key={`${item.at}-${index}`}><span>{formatDateTime(item.at)}</span><b>{item.action}</b><em>{item.actor}</em><small>{item.detail}</small></div>) : <EmptyState icon={Activity} text="Sin actividad de mando todavía."/>}</div></section>
}
