import { useEffect, useState } from 'react'
import { Activity, ArchiveRestore, CircleDollarSign, ClipboardList, Database, Download, FileArchive, FileText, HardDrive, LayoutDashboard, LogOut, Package, RefreshCw, Search, ShieldCheck, Terminal, Trash2, Users, WalletCards, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { clearStreamlinxSession, getStreamlinxOperator, hasStreamlinxSession } from '../lib/auth'
import { createBackupSnapshot, getArchivedClosures, getArchivedOrders, getArchivedProducts, getArchivedSales, getArchivedUsers, getAuditEvents, getBackupSnapshots, getGeneralSettings, getHistoryRecords, purgeSalesData, restoreArchivedRecord } from '../lib/store'
import { money } from '../lib/format'
import { printSaleReceipt } from '../lib/print'
import type { AuditEvent, BackupSnapshot, CashClosure, HistoryRecord, Order, Product, Sale, User } from '../lib/types'

const tabs = [['command','Command',LayoutDashboard],['audit','Audit',Activity],['invoices','Invoices',FileText],['orders','Orders',ClipboardList],['products','Products',Package],['users','Users',Users],['cash','Cash',WalletCards],['recovery','Recovery',ArchiveRestore],['backups','Backups',HardDrive],['system','System',Database]] as const
type Tab = typeof tabs[number][0]
type Data = { sales: Sale[]; orders: Order[]; products: Product[]; users: User[]; closures: CashClosure[]; audit: AuditEvent[]; history: HistoryRecord[]; backups: BackupSnapshot[] }
const blank: Data = { sales: [], orders: [], products: [], users: [], closures: [], audit: [], history: [], backups: [] }
const fmt = (n: number) => money(Math.round(n || 0))
const stamp = (value?: string) => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'
const labelRole = (role?: User['role']) => role === 'manager' ? 'Gerente' : role === 'admin' ? 'Administrador' : 'Trabajador'

export function StreamLinx() {
  const nav = useNavigate()
  const [tab,setTab] = useState<Tab>('command')
  const [data,setData] = useState<Data>(blank)
  const [query,setQuery] = useState('')
  const [loading,setLoading] = useState(true)
  const [toast,setToast] = useState('')
  const [saleToDelete,setSaleToDelete] = useState<Sale | null>(null)
  const [salesDeleteAllOpen,setSalesDeleteAllOpen] = useState(false)
  const [salesBusy,setSalesBusy] = useState(false)
  const [current, setCurrent] = useState<User | null>(null)
  const [receiptFontSize, setReceiptFontSize] = useState(10)

  const load = async () => {
    setLoading(true)
    try {
      const [sales,orders,products,users,closures,audit,history,backups,settings] = await Promise.all([
        getArchivedSales(),getArchivedOrders(),getArchivedProducts(),getArchivedUsers(),getArchivedClosures(),getAuditEvents(),getHistoryRecords(),getBackupSnapshots(),getGeneralSettings()
      ])
      setData({sales,orders,products,users,closures,audit,history,backups})
      setReceiptFontSize(settings.receiptFontSize)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      if (!hasStreamlinxSession()) {
        nav('/login', { replace: true })
        return
      }
      const operator = await getStreamlinxOperator()
      if (cancelled) return
      if (!operator) {
        clearStreamlinxSession()
        nav('/login', { replace: true })
        return
      }
      setCurrent(operator)
      await load()
    }
    void init()
    return () => { cancelled = true }
  }, [nav])
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(''), 3200); return () => window.clearTimeout(id) }, [toast])

  const match = (item: unknown) => !query.trim() || JSON.stringify(item).toLowerCase().includes(query.trim().toLowerCase())
  const sales = data.sales.filter(x => !x.deletedAt)
  const todayKey = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  const today = sales.filter(s => (s.businessDateKey || s.createdAt.slice(0,10)) === todayKey).reduce((n,s) => n + s.total, 0)

  const backup = async (kind: BackupSnapshot['kind'] = 'manual') => {
    const actor = current || await getStreamlinxOperator()
    if (!actor) return setToast('Acceso StreamLinx no válido. Vuelve a entrar con el PIN de StreamLinx.')
    const saved = await createBackupSnapshot(actor,kind,kind === 'manual' ? 'Backup manual StreamLinx' : 'Snapshot previo a operación crítica')
    setToast(`Backup creado · ${Math.ceil(saved.size/1024)} KB`)
    await load()
  }

  const restore = async (entity: string,id: string) => {
    const actor = current || await getStreamlinxOperator()
    if (!actor) return setToast('Acceso StreamLinx no válido. Vuelve a entrar con el PIN de StreamLinx.')
    const ok = await restoreArchivedRecord(entity,id,actor)
    setToast(ok ? 'Registro restaurado de forma segura' : 'El registro no puede restaurarse')
    await load()
  }

  const deleteSales = async (saleIds?: string[]) => {
    if (salesBusy) return
    setSalesBusy(true)
    try {
      const actor = current || await getStreamlinxOperator()
      if (!actor) {
        setToast('Acceso StreamLinx no válido. Vuelve a entrar con el PIN de StreamLinx.')
        return
      }
      const result = await purgeSalesData(actor, saleIds)
      if (!result.ok) {
        setToast(result.error || 'No fue posible eliminar las ventas')
        return
      }
      setSaleToDelete(null)
      setSalesDeleteAllOpen(false)
      const count = Number(result.sales || 0)
      setToast(result.pending
        ? `${count} venta${count === 1 ? '' : 's'} eliminada${count === 1 ? '' : 's'} localmente · sincronización pendiente`
        : `${count} venta${count === 1 ? '' : 's'} eliminada${count === 1 ? '' : 's'} definitivamente`)
      await load()
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'No fue posible eliminar las ventas')
    } finally {
      setSalesBusy(false)
    }
  }

  const download = (backup: BackupSnapshot) => {
    const blob = new Blob([JSON.stringify(backup.payload,null,2)],{type:'application/json'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href=url; a.download=`streamlinx-${backup.id}.json`; a.click(); URL.revokeObjectURL(url)
  }

  return <div className="slx-shell slx-command-shell streamlinx-command-center">
    <aside className="slx-sidebar slx-command-sidebar">
      <div className="slx-brand"><div className="slx-logo-wrap"><img src="/Streamlinx.png" alt="StreamLinx"/><span>S</span></div><div><b>StreamLinx</b><small>COMMAND CENTER</small></div></div>
      <div className="slx-access slx-access-manager"><span className="slx-pulse"/>MANDO STREAMLINX<b>LEVEL 05</b></div>
      <nav>{tabs.map(([id,name,Icon]) => <button key={id} className={tab===id?'active':''} onClick={() => {setTab(id);setQuery('')}}><Icon size={15}/>{name}</button>)}</nav>
      <div className="slx-sidebar-bottom"><div className="slx-terminal-mini"><Terminal size={14}/><div><b>AUDIT STORAGE</b><span>{loading?'Sincronizando…':`${data.audit.length} eventos protegidos`}</span></div><i/></div><button onClick={() => { clearStreamlinxSession(); nav('/login', { replace: true }) }}><LogOut size={14}/>Salir del centro</button></div>
    </aside>
    <main className="slx-main">
      <header className="slx-topbar"><div><span className="slx-kicker">STREAMLINX COMMAND CENTER</span><span className="slx-separator">/</span><span className="slx-muted">AUDIT · RECOVERY · SUPERVISION</span></div><strong>{loading?'SYNC…':'CORE ONLINE'}</strong></header>
      <section className="slx-content slx-command-content">
        <div className="slx-command-head"><div><span className="slx-kicker">PRIVILEGED OPERATIONS</span><h1>Control histórico.</h1><p>Consola administrativa superior. Desde aquí puedes administrar y purgar las ventas sin pedir PIN de gerente.</p></div><div className="slx-admin-badge"><ShieldCheck size={15}/>SUPER ADMINISTRACIÓN</div></div>
        <div className="slx-command-strip"><Metric label="VENTAS HOY" value={fmt(today)} note={`${sales.filter(s=>(s.businessDateKey||s.createdAt.slice(0,10))===todayKey).length} facturas`}/><Metric label="VENTAS" value={String(sales.length)} note="activas"/><Metric label="ARCHIVO" value={String(data.sales.filter(s=>s.deletedAt).length)} note="facturas archivadas"/><Metric label="EVENTOS" value={String(data.audit.length)} note="append-only"/><Metric label="VERSIONES" value={String(data.history.length)} note="snapshots históricos"/></div>
        {tab!=='command'&&<div className="slx-toolbar-command"><div><b>{tabs.find(x=>x[0]===tab)?.[1]}</b><span> / STREAMLINX CORE</span></div><div className="slx-toolbar-actions"><div className="slx-command-search"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar ID, factura, usuario, acción…"/></div><button className="slx-ghost-btn" onClick={()=>void load()}><RefreshCw size={14}/>Sync</button></div></div>}
        {tab==='command'&&<Command data={data} today={today} go={setTab} onBackup={()=>void backup()}/>} 
        {tab==='audit'&&<Audit events={data.audit.filter(match)}/>} 
        {tab==='invoices'&&<Invoices sales={data.sales.filter(match)} history={data.history} fontSize={receiptFontSize} onDelete={sale=>setSaleToDelete(sale)} onDeleteAll={()=>setSalesDeleteAllOpen(true)}/>} 
        {tab==='orders'&&<Registry title="Pedidos" records={data.orders.filter(match)} entity="order" restore={restore}/>} 
        {tab==='products'&&<Registry title="Productos" records={data.products.filter(match)} entity="product" restore={restore}/>} 
        {tab==='users'&&<Registry title="Usuarios y roles" records={data.users.filter(match)} entity="user" restore={restore} users/>} 
        {tab==='cash'&&<Registry title="Cierres de caja" records={data.closures.filter(match)} entity="closure" restore={restore}/>} 
        {tab==='recovery'&&<Recovery history={data.history.filter(match)} restore={restore}/>} 
        {tab==='backups'&&<Backups backups={data.backups.filter(match)} create={()=>void backup()} download={download}/>} 
        {tab==='system'&&<System events={data.audit.filter(match)} backup={()=>void backup()} onDeleteAll={()=>setSalesDeleteAllOpen(true)} saleCount={data.sales.length}/>} 
      </section>
    </main>

    {saleToDelete&&<SaleDeleteModal sale={saleToDelete} busy={salesBusy} onCancel={()=>!salesBusy&&setSaleToDelete(null)} onConfirm={()=>void deleteSales([saleToDelete.id])}/>} 
    {salesDeleteAllOpen&&<DeleteAllSalesModal count={sales.length} busy={salesBusy} onCancel={()=>!salesBusy&&setSalesDeleteAllOpen(false)} onConfirm={()=>void deleteSales()}/>} 
    {toast&&<div className="slx-toast"><ShieldCheck size={14}/>{toast}</div>}
  </div>
}
function Metric({label,value,note}:{label:string;value:string;note:string}) { return <div><span>{label}</span><b>{value}</b><small>{note}</small></div> }
function Command({data,today,go,onBackup}:{data:Data;today:number;go:(tab:Tab)=>void;onBackup:()=>void}) { const archived=data.sales.filter(x=>x.deletedAt).length+data.orders.filter(x=>x.deletedAt).length+data.products.filter(x=>x.deletedAt).length; return <div className="slx-command-grid"><div className="slx-command-hero-panel"><ShieldCheck size={20}/><div><span className="slx-kicker">COMMAND STATUS</span><h2>Mando StreamLinx activo</h2><p>Auditoría centralizada con versiones sanitizadas y archivo de eliminaciones.</p></div></div><Quick title="Ventas hoy" value={fmt(today)} icon={CircleDollarSign} go={()=>go('invoices')}/><Quick title="Archivo" value={String(archived)} icon={FileArchive} go={()=>go('recovery')}/><Quick title="Auditoría" value={String(data.audit.length)} icon={Activity} go={()=>go('audit')}/><Quick title="Backups" value={String(data.backups.length)} icon={HardDrive} go={()=>go('backups')}/><div className="slx-command-wide"><div className="slx-command-wide-head"><div><span className="slx-kicker">RECENT ACTIVITY</span><h3>Eventos de sistema</h3></div></div><AuditRows events={data.audit.slice(0,8)}/></div><div className="slx-command-wide"><div className="slx-command-wide-head"><div><span className="slx-kicker">SAFE RECOVERY</span><h3>Protección de datos</h3></div><button className="slx-command-primary small" onClick={onBackup}>CREAR BACKUP</button></div><p className="slx-info-note">Los borrados del POS se conservan como tombstones y se pueden consultar o restaurar desde Recovery Center.</p></div></div> }
function Quick({title,value,icon:Icon,go}:{title:string;value:string;icon:typeof Activity;go:()=>void}) { return <button className="slx-command-card" onClick={go}><div className="slx-command-card-icon"><Icon size={17}/></div><div><span>{title}</span><b>{value}</b><small>ver detalle</small></div></button> }
function AuditRows({events}:{events:AuditEvent[]}) { return events.length?<div className="slx-audit-list">{events.map(e=><div className="slx-audit-row" key={e.id}><span>{stamp(e.timestamp)}</span><b>{e.action}</b><em>{e.actorName} · {labelRole(e.role)}</em><small>{e.module} / {e.recordId||'sistema'}</small></div>)}</div>:<Empty text="Sin eventos registrados."/> }
function Audit({events}:{events:AuditEvent[]}) { return <section className="slx-data-panel"><div className="slx-panel-head"><div><span className="slx-kicker">APPEND-ONLY LEDGER</span><h2>Auditoría inmutable</h2></div><span>{events.length} eventos</span></div><AuditRows events={events}/></section> }
function Invoices({sales,history,fontSize,onDelete,onDeleteAll}:{sales:Sale[];history:HistoryRecord[];fontSize:number;onDelete:(sale:Sale)=>void;onDeleteAll:()=>void}) {
  return <section className="slx-data-panel">
    <div className="slx-panel-head">
      <div><span className="slx-kicker">INVOICE ARCHIVE</span><h2>Facturas activas y archivadas</h2></div>
      <div className="slx-panel-head-actions"><span>{sales.length} registros</span>{sales.length>0&&<button className="slx-danger-btn small" onClick={onDeleteAll}><Trash2 size={14}/>Borrar todas las ventas</button>}</div>
    </div>
    <div className="slx-data-table-wrap"><table className="slx-data-table"><thead><tr><th>Factura</th><th>Fecha</th><th>Cliente</th><th>Usuario</th><th>Total</th><th>Estado</th><th>Versiones</th><th>Acciones</th></tr></thead><tbody>
      {sales.map(s=><tr key={s.id}><td><b>#{s.orderNumber??s.id.slice(-6)}</b></td><td>{stamp(s.createdAt)}</td><td>{s.customerName||'Consumidor final'}</td><td>{s.userName}</td><td><b>{fmt(s.total)}</b></td><td><span className={`slx-chip ${s.deletedAt?'muted':'positive'}`}>{s.deletedAt?'HISTÓRICA / ELIMINADA':'ORIGINAL'}</span></td><td>{history.filter(h=>h.entity==='sale'&&h.recordId===s.id).length}</td><td><div className="slx-row-actions"><button className="slx-row-btn" onClick={()=>printSaleReceipt(s,fontSize,s.deletedAt?'HISTÓRICA · ELIMINADA':'COPIA')} title="Imprimir factura"><FileText size={14}/></button><button className="slx-row-btn slx-row-btn-danger" onClick={()=>onDelete(s)} title="Borrar definitivamente"><Trash2 size={14}/></button></div></td></tr>)}
    </tbody></table></div>
  </section>
}
function Registry({title,records,entity,restore,users}:{title:string;records:Record<string,unknown>[];entity:string;restore:(e:string,id:string)=>void;users?:boolean}) { return <section className="slx-data-panel"><div className="slx-panel-head"><div><span className="slx-kicker">HISTORICAL REGISTRY</span><h2>{title}</h2></div><span>{records.length} registros</span></div><div className="slx-data-table-wrap"><table className="slx-data-table"><thead><tr><th>ID / referencia</th><th>Detalle</th><th>Estado</th><th>Actualizado</th><th/></tr></thead><tbody>{records.map(r=>{const id=String(r.id),deleted=Boolean(r.deletedAt),name=String(r.name||r.customerName||r.dateKey||`#${r.orderNumber||id.slice(-6)}`);return <tr key={id}><td><b>{name}</b><small>{id}</small></td><td>{users?`${labelRole(r.role as User['role'])} · ${String(r.rank||'')}`:String(r.status||r.category||r.userName||r.total||'—')}</td><td><span className={`slx-chip ${deleted?'muted':'positive'}`}>{deleted?'ARCHIVADO':r.active===false?'INACTIVO':'ACTIVO'}</span></td><td>{stamp(String(r.updatedAt||r.closedAt||r.createdAt||''))}</td><td>{deleted&&<button className="slx-row-btn" onClick={()=>restore(entity,id)}><ArchiveRestore size={14}/></button>}</td></tr>})}</tbody></table></div></section> }
function Recovery({history,restore}:{history:HistoryRecord[];restore:(e:string,id:string)=>void}) { return <section className="slx-data-panel"><div className="slx-panel-head"><div><span className="slx-kicker">RECOVERY CENTER</span><h2>Versiones y tombstones</h2></div><span>{history.length} snapshots</span></div><div className="slx-audit-list">{history.map(h=><div className="slx-audit-row" key={h.id}><span>{stamp(h.capturedAt)}</span><b>{h.entity.toUpperCase()} · V{h.version}</b><em>{h.deleted?'TOMBSTONE':'VERSIÓN'}</em><small>{h.recordId}</small>{h.deleted&&<button className="slx-row-btn" onClick={()=>restore(h.entity,h.recordId)}><ArchiveRestore size={14}/></button>}</div>)}</div></section> }
function Backups({backups,create,download}:{backups:BackupSnapshot[];create:()=>void;download:(b:BackupSnapshot)=>void}) { return <section className="slx-data-panel"><div className="slx-panel-head"><div><span className="slx-kicker">BACKUP VAULT</span><h2>Snapshots disponibles</h2></div><button className="slx-command-primary small" onClick={create}><FileArchive size={14}/>BACKUP MANUAL</button></div><div className="slx-audit-list">{backups.map(b=><div className="slx-audit-row" key={b.id}><span>{stamp(b.createdAt)}</span><b>{b.label}</b><em>{b.kind}</em><small>{Math.ceil(b.size/1024)} KB · {Object.values(b.contents).reduce((a,n)=>a+n,0)} objetos</small><button className="slx-row-btn" onClick={()=>download(b)}><Download size={14}/></button></div>)}{!backups.length&&<Empty text="No hay snapshots; cree el primero antes de intervenir datos."/>}</div></section> }
function System({events,backup,onDeleteAll,saleCount}:{events:AuditEvent[];backup:()=>void;onDeleteAll:()=>void;saleCount:number}) {
  return <section className="slx-data-panel"><div className="slx-panel-head"><div><span className="slx-kicker">SYSTEM EVENTS</span><h2>Estado técnico y operaciones críticas</h2></div><span>SUPABASE + OUTBOX OFFLINE</span></div>
    <div className="slx-system-grid">{['Caché IndexedDB durable','Outbox de sincronización','Auditoría replicada','Historial de versiones','Vault de backups','Sanitización de secretos'].map(x=><div className="slx-system-check" key={x}><ShieldCheck size={15}/><div><b>{x}</b><span>SYNC</span></div><i/></div>)}</div>
    <div className="slx-danger-zone"><div><span className="slx-kicker">DESTRUCTIVE OPERATIONS</span><h3>Control de ventas</h3><p>Este panel es superior al POS. No solicita PIN de gerente. Puedes borrar una venta concreta desde Invoices o borrar todas las ventas de forma permanente.</p></div><div className="slx-danger-actions"><button className="slx-danger-btn" onClick={backup}><FileArchive size={14}/>Backup</button><button className="slx-danger-btn" disabled={!saleCount} onClick={onDeleteAll}><Trash2 size={14}/>Borrar todas las ventas</button></div></div>
    <AuditRows events={events.slice(0,12)}/>
  </section>
}
function SaleDeleteModal({sale,busy,onCancel,onConfirm}:{sale:Sale;busy:boolean;onCancel:()=>void;onConfirm:()=>void}) {
  return <div className="slx-cmd-overlay"><div className="slx-confirm-modal"><button className="slx-v2-close" onClick={onCancel} disabled={busy}><X size={15}/></button><span className="slx-kicker">PERMANENT SALES PURGE</span><h2>¿Borrar esta venta definitivamente?</h2><p>Factura <b>#{sale.orderNumber??sale.id.slice(-6)}</b> · {fmt(sale.total)} · {sale.userName||'—'}</p><div className="slx-confirm-warning">Se eliminará del servidor, de IndexedDB, del historial de StreamLinx y de las copias donde aún esté guardada.</div><div className="slx-danger-actions"><button className="slx-ghost-btn" onClick={onCancel} disabled={busy}>Cancelar</button><button className="slx-danger-btn" onClick={onConfirm} disabled={busy}><Trash2 size={14}/>{busy?'BORRANDO…':'BORRAR DEFINITIVAMENTE'}</button></div></div></div>
}

function DeleteAllSalesModal({count,busy,onCancel,onConfirm}:{count:number;busy:boolean;onCancel:()=>void;onConfirm:()=>void}) {
  return <div className="slx-cmd-overlay"><div className="slx-confirm-modal"><button className="slx-v2-close" onClick={onCancel} disabled={busy}><X size={15}/></button><span className="slx-kicker">GLOBAL SALES PURGE</span><h2>¿Borrar todas las ventas?</h2><p>Se van a eliminar <b>{count}</b> venta{count===1?'':'s'} definitivamente.</p><div className="slx-confirm-warning">No crea backup y no requiere PIN de gerente. La operación también manda un marcador de purga para que otros dispositivos limpien su caché y no vuelvan a subir las ventas.</div><div className="slx-danger-actions"><button className="slx-ghost-btn" onClick={onCancel} disabled={busy}>Cancelar</button><button className="slx-danger-btn" onClick={onConfirm} disabled={busy}><Trash2 size={14}/>{busy?'BORRANDO…':'BORRAR TODAS LAS VENTAS'}</button></div></div></div>
}

function Empty({text}:{text:string}) { return <div className="slx-empty"><ArchiveRestore size={25}/><b>{text}</b></div> }
