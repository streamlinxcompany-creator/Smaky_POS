import { AlertTriangle, Check, FileText, MapPin, Phone, Plus, Search, UserPlus, UserRound, UsersRound, UtensilsCrossed, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { OrderWorkspace } from '../components/OrderWorkspace'
import { getSessionUser } from '../lib/auth'
import { getSyncState, SYNC_CHANGE_EVENT, syncOrdersNow, type SyncState } from '../lib/sync'
import { createCustomer, getClosureByDate, getCustomers, getGeneralSettings, getOrderFields, getOrders, recordBusinessDayKey, updateCustomer } from '../lib/store'
import { date, money, time } from '../lib/format'
import type { CashClosure, Customer, Order, OrderFieldConfig, OrderStatus } from '../lib/types'

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
  const [syncState, setSyncState] = useState<SyncState>({ syncing: false, pending: 0 })
  const [creating, setCreating] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false)
  const [customerFormOpen, setCustomerFormOpen] = useState(false)
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerList, setCustomerList] = useState<Customer[]>([])
  const [customerForm, setCustomerForm] = useState<{ name: string; phone: string; address: string; notes: string; customFields: Record<string, string> }>({ name: '', phone: '', address: '', notes: '', customFields: {} })
  const [orderFields, setOrderFields] = useState<OrderFieldConfig[]>([])
  const [generalSettings, setGeneralSettings] = useState({ showConsumerFinal: false })
  const [customerSaving, setCustomerSaving] = useState(false)
  const [customerError, setCustomerError] = useState('')
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

  useEffect(() => {
    let disposed = false
    let refreshTimer: number | null = null
    const refreshWhenSyncChanges = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null
        if (!disposed) void refresh()
      }, 120)
    }
    const runOrderSync = async () => {
      const state = await syncOrdersNow()
      if (disposed) return
      setSyncState(state)
      await refresh()
    }
    const onSyncChange = (event: Event) => {
      const state = (event as CustomEvent<SyncState>).detail
      if (state) setSyncState(state)
      refreshWhenSyncChanges()
    }
    const onOnline = () => { void runOrderSync() }
    void refresh()
    void getSyncState().then(state => { if (!disposed) setSyncState(state) })
    // La lista se lee primero desde IndexedDB y después desde Supabase. Así el
    // POS abre rápido, pero no se queda congelado mostrando solo la caché local.
    void runOrderSync()
    const poll = window.setInterval(() => {
      if (!disposed && navigator.onLine && document.visibilityState === 'visible') void runOrderSync()
    }, 12_000)
    window.addEventListener(SYNC_CHANGE_EVENT, onSyncChange)
    window.addEventListener('online', onOnline)
    return () => {
      disposed = true
      window.clearInterval(poll)
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      window.removeEventListener(SYNC_CHANGE_EVENT, onSyncChange)
      window.removeEventListener('online', onOnline)
    }
  }, [])
  useEffect(() => {
    const loadFields = () => { void Promise.all([getOrderFields(), getGeneralSettings()]).then(([fields, general]) => { setOrderFields(fields); setGeneralSettings(general) }) }
    loadFields()
    const onSettings = () => loadFields()
    window.addEventListener('smaky-settings-change', onSettings)
    return () => window.removeEventListener('smaky-settings-change', onSettings)
  }, [])

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

  const openCustomerPicker = async () => {
    setCustomerSearch('')
    setCustomerError('')
    setCustomerFormOpen(false)
    setCustomerPickerOpen(true)
    setCustomerList(await getCustomers())
  }

  const beginNewOrder = () => {
    if (todayClosure) {
      setClosureWarning(todayClosure)
      return
    }
    void openCustomerPicker()
  }

  const continueAfterClosure = () => {
    setClosureWarning(null)
    void openCustomerPicker()
  }

  const requiredFieldsMissing = (customer: Customer | null) => orderFields.filter(field => field.enabled && field.required).find(field => {
    const value = field.system
      ? ({ name: customer?.name, phone: customer?.phone, address: customer?.address, notes: customer?.notes } as Record<string, string | undefined>)[field.id]
      : customer?.customFields?.[field.id]
    return !String(value || '').trim()
  })

  const chooseCustomer = (customer: Customer | null) => {
    const missing = requiredFieldsMissing(customer)
    if (customer && missing) {
      setCustomerError(`Este cliente necesita completar “${missing.label}” antes de crear el pedido.`)
      setCustomerForm({ name: customer.name, phone: customer.phone, address: customer.address, notes: customer.notes, customFields: { ...(customer.customFields || {}) } })
      setEditingCustomerId(customer.id)
      setCustomerFormOpen(true)
      return
    }
    setSelectedCustomer(customer)
    setCustomerPickerOpen(false)
    setCustomerFormOpen(false)
    setEditingCustomerId(null)
    setCreating(true)
  }

  const openCustomerForm = (customer?: Customer) => {
    setCustomerError('')
    setEditingCustomerId(customer?.id || null)
    setCustomerForm({
      name: customer?.name || '',
      phone: customer?.phone || customerSearch.replace(/\D/g, ''),
      address: customer?.address || '',
      notes: customer?.notes || '',
      customFields: Object.fromEntries(orderFields.filter(field => !field.system).map(field => [field.id, customer?.customFields?.[field.id] || '']))
    })
    setCustomerFormOpen(true)
  }

  const saveNewCustomer = async () => {
    if (!user || customerSaving) return
    setCustomerSaving(true)
    setCustomerError('')
    try {
      const missing = orderFields.filter(field => field.enabled && field.required).find(field => {
        const value = field.system ? ({ name: customerForm.name, phone: customerForm.phone, address: customerForm.address, notes: customerForm.notes } as Record<string, string>)[field.id] : customerForm.customFields[field.id]
        return !String(value || '').trim()
      })
      if (missing) throw new Error(`Completa el campo “${missing.label}”.`)
      const customer = editingCustomerId
        ? await updateCustomer(editingCustomerId, customerForm, user)
        : await createCustomer(customerForm, user)
      if (!customer) throw new Error('No fue posible actualizar el cliente.')
      setCustomerList(current => editingCustomerId ? current.map(item => item.id === customer.id ? customer : item) : [customer, ...current])
      setSelectedCustomer(customer)
      setCustomerPickerOpen(false)
      setCustomerFormOpen(false)
      setEditingCustomerId(null)
      setCreating(true)
    } catch (caught) {
      setCustomerError(caught instanceof Error ? caught.message : 'No fue posible guardar el cliente.')
    } finally {
      setCustomerSaving(false)
    }
  }

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase()
    if (!q) return customerList
    return customerList.filter(customer => customer.name.toLowerCase().includes(q) || customer.phone.includes(q))
  }, [customerList, customerSearch])

  const customerPickerModal = customerPickerOpen ? <div className="customer-picker-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !customerSaving) setCustomerPickerOpen(false) }}>
    <section className="customer-picker" role="dialog" aria-modal="true" aria-labelledby="customer-picker-title">
      {!customerFormOpen ? <><header className="customer-picker-head"><div className="customer-picker-title"><div className="customer-picker-icon"><UsersRound size={19}/></div><div><span className="eyebrow">NUEVO PEDIDO</span><h2 id="customer-picker-title">¿Para quién es el pedido?</h2><p>Busca el celular o selecciona un cliente.</p></div></div><button className="item-editor-close" onClick={() => setCustomerPickerOpen(false)} aria-label="Cerrar"><X size={18}/></button></header>
        <div className="customer-picker-toolbar"><label className="customer-picker-search"><Search size={17}/><input autoFocus value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="Buscar por celular o nombre…" inputMode="search"/></label><button className="customer-add-btn" onClick={openCustomerForm}><UserPlus size={16}/> Agregar cliente</button></div>
        <div className="customer-picker-list">
          {/* Consumidor final se controla desde Configuraciones → General. */}
          {generalSettings.showConsumerFinal && <button className="customer-picker-row guest" onClick={() => chooseCustomer(null)}><div className="customer-picker-avatar guest"><UserRound size={17}/></div><div><b>Consumidor final</b><span>Continuar sin guardar cliente</span></div><Check size={16}/></button>}
          {filteredCustomers.map(customer => <button className="customer-picker-row" key={customer.id} onClick={() => chooseCustomer(customer)}><div className="customer-picker-avatar"><UserRound size={17}/></div><div><b>{customer.name}</b><span><Phone size={12}/> {customer.phone}{customer.address ? <> · <MapPin size={12}/> {customer.address}</> : null}</span></div><span className="customer-picker-arrow">→</span></button>)}
          {!filteredCustomers.length && <div className="customer-picker-empty"><UserRound size={24}/><b>No hay coincidencias</b><span>Agrega este número como cliente nuevo.</span><button className="primary-inline" onClick={openCustomerForm}><UserPlus size={15}/> Agregar cliente</button></div>}
        </div>
      </> : <><header className="customer-picker-head"><div className="customer-picker-title"><div className="customer-picker-icon"><UserPlus size={19}/></div><div><span className="eyebrow">{editingCustomerId ? 'DATOS DEL CLIENTE' : 'NUEVO CLIENTE'}</span><h2>{editingCustomerId ? 'Completar cliente' : 'Agregar cliente'}</h2><p>{editingCustomerId ? 'Completa los campos solicitados para este pedido.' : 'El celular será su forma de búsqueda.'}</p></div></div><button className="item-editor-close" onClick={() => setCustomerFormOpen(false)} aria-label="Volver"><X size={18}/></button></header>
        <div className="customer-picker-form">{orderFields.filter(field => field.enabled).map((field, index) => {
          const value = field.system ? ({ name: customerForm.name, phone: customerForm.phone, address: customerForm.address, notes: customerForm.notes } as Record<string, string>)[field.id] || '' : customerForm.customFields[field.id] || ''
          const setValue = (next: string) => setCustomerForm(current => field.system ? { ...current, [field.id]: next } : { ...current, customFields: { ...current.customFields, [field.id]: next } })
          const commonProps = { autoFocus: index === 0, value, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValue(event.target.value) }
          return <label className={field.type === 'textarea' || field.type === 'address' || field.id === 'address' ? 'customer-field-wide' : ''} key={field.id}><span>{field.label}{field.required ? ' · Obligatorio' : ''}</span>{field.type === 'textarea' ? <textarea {...commonProps} placeholder={field.id === 'notes' ? 'Ej. Casa azul, toca el timbre…' : 'Escribe aquí…'} /> : field.type === 'select' ? <select {...commonProps}><option value="">Selecciona una opción…</option>{(field.options || []).map(option => <option value={option} key={option}>{option}</option>)}</select> : <input {...commonProps} type={field.type === 'number' ? 'number' : field.type === 'phone' ? 'tel' : 'text'} inputMode={field.type === 'number' ? 'decimal' : field.type === 'phone' ? 'tel' : undefined} placeholder={field.type === 'phone' ? '300 000 0000' : field.type === 'address' || field.id === 'address' ? 'Dirección de entrega' : 'Escribe aquí…'} />}</label>
        })}{customerError && <div className="customers-feedback error">{customerError}</div>}</div>
        <footer className="customer-picker-foot"><button className="secondary" disabled={customerSaving} onClick={() => { setCustomerFormOpen(false); setEditingCustomerId(null) }}>Volver</button><button className="primary" disabled={customerSaving || !customerForm.name.trim() || !customerForm.phone.trim()} onClick={() => void saveNewCustomer()}>{customerSaving ? 'Guardando…' : <><Plus size={15}/> {editingCustomerId ? 'Actualizar y usar cliente' : 'Guardar y usar cliente'}</>}</button></footer>
      </>}
    </section>
  </div> : null

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

  const syncWarning = syncState.pending > 0 && syncState.lastError ? <div className="customers-feedback error pos-sync-warning" role="alert">
    <span><b>{syncState.pending} cambio(s) pendiente(s) de sincronizar.</b> {syncState.lastError}</span>
    <button type="button" onClick={() => { void syncOrdersNow().then(async state => { setSyncState(state); await refresh() }) }}>Reintentar</button>
  </div> : null

  if (creating) return <OrderWorkspace
    user={user}
    initialCustomer={selectedCustomer}
    onClose={() => { setCreating(false); setSelectedCustomer(null); void refresh() }}
    onOrderChange={updateLocalOrder}
  />

  if (selected) return <OrderWorkspace
    user={user}
    initialOrder={selected}
    onClose={() => { setSelected(null); void refresh() }}
    onOrderChange={updateLocalOrder}
  />

  if (loading) return <>{syncWarning}<div className="pos-orders-page"><div className="pos-orders-loading">Cargando pedidos de hoy…</div></div>{customerPickerModal}</>

  if (!todayOrders.length) return <>{syncWarning}<div className="pos-landing">
    <div className="pos-landing-card">
      <div className="pos-landing-icon"><UtensilsCrossed size={26}/></div>
      <p className="eyebrow">PUNTO DE VENTA</p>
      <h1>Registrar nuevo pedido</h1>
      <p>Un solo panel para agregar productos, poner modificaciones, imprimir la comanda y cobrar cuando corresponda.</p>
      <button className="primary landing-primary" onClick={beginNewOrder}><Plus size={18}/> Registrar nuevo pedido</button>
    </div>
    {closureWarningModal}
    {customerPickerModal}
  </div></>

  return <>{syncWarning}<div className="pos-orders-page">
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
        <div className="order-square-top"><span>{order.customerName || 'Pedido'}</span><b>#{order.orderNumber}</b></div>
        <div className="order-square-icon"><FileText size={19}/></div>
        <strong>{money(order.total)}</strong>
        <span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} {order.items.reduce((sum, item) => sum + item.quantity, 0) === 1 ? 'producto' : 'productos'}</span>
        <small>{statusLabel[order.status]}</small>
        {order.comandaStatus === 'skipped' && <em>Sin comanda</em>}
        <em>{date(order.createdAt)} · {time(order.createdAt)}</em>
      </button>)}
    </div>

    {closureWarningModal}
    {customerPickerModal}
  </div></>
}
