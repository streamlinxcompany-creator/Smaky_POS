import {
  ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight,
  Clock3, Download, Eye, Heart, MapPin, Pencil, Phone, Plus, Printer, ReceiptText,
  RefreshCw, Search, ShoppingBag, Sparkles, Star, Tag, Trash2, UserRound, Wallet, X,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { getSessionUser, hasPermission } from '../lib/auth'
import { getGeneralSettings, createCustomer, deactivateCustomer, getCustomers, getOrderFields, updateCustomer } from '../lib/store'
import { supabase } from '../lib/supabase'
import { printSaleReceipt } from '../lib/print'
import { money } from '../lib/format'
import type { Customer, OrderFieldConfig, Sale } from '../lib/types'

const emptyForm = { name: '', phone: '', address: '', notes: '', customFields: {} as Record<string, string> }
type FormState = typeof emptyForm
const PROFILE_PAGE_SIZE = 10

type Customer360Summary = {
  totalSales: number
  totalSpent: number
  averageTicket: number
  firstPurchaseAt: string | null
  lastPurchaseAt: string | null
}
type Customer360Product = { productId: string; name: string; quantity: number; orders: number; totalSpent: number }
type Customer360Observation = { text: string; count: number }
type Customer360Result = {
  canViewPurchases: boolean
  summary: Customer360Summary
  favoriteProducts: Customer360Product[]
  frequentObservations: Customer360Observation[]
  sales: Sale[]
  hasMore: boolean
}
type CustomerProfileTab = 'summary' | 'history' | 'preferences' | 'details'

const emptyProfileResult: Customer360Result = {
  canViewPurchases: false,
  summary: { totalSales: 0, totalSpent: 0, averageTicket: 0, firstPurchaseAt: null, lastPurchaseAt: null },
  favoriteProducts: [], frequentObservations: [], sales: [], hasMore: false,
}

async function fetchCustomer360(customerId: string, offset: number): Promise<Customer360Result> {
  if (!supabase) throw new Error('No está disponible la conexión con Supabase.')
  const { data, error } = await supabase.rpc('customer_profile_360', {
    p_customer_id: customerId,
    p_history_offset: offset,
    p_history_limit: PROFILE_PAGE_SIZE,
  })
  if (error) throw new Error(error.message || 'No se pudo cargar el perfil del cliente.')
  if (!data || typeof data !== 'object') throw new Error('Supabase devolvió un perfil de cliente vacío.')
  const raw = data as Partial<Customer360Result>
  const summary = raw.summary && typeof raw.summary === 'object' ? raw.summary : emptyProfileResult.summary
  return {
    canViewPurchases: Boolean(raw.canViewPurchases),
    summary: {
      totalSales: Number(summary.totalSales) || 0,
      totalSpent: Number(summary.totalSpent) || 0,
      averageTicket: Number(summary.averageTicket) || 0,
      firstPurchaseAt: summary.firstPurchaseAt || null,
      lastPurchaseAt: summary.lastPurchaseAt || null,
    },
    favoriteProducts: Array.isArray(raw.favoriteProducts) ? raw.favoriteProducts : [],
    frequentObservations: Array.isArray(raw.frequentObservations) ? raw.frequentObservations : [],
    sales: Array.isArray(raw.sales) ? raw.sales as Sale[] : [],
    hasMore: Boolean(raw.hasMore),
  }
}

const normalizePreference = (value: string) => value.trim().replace(/\s+/g, ' ')
const preferenceKey = (value: string) => normalizePreference(value).toLocaleLowerCase('es')
const dateTime = (value?: string | null) => {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
}
const daysSince = (value?: string | null) => {
  if (!value) return null
  const parsed = new Date(value).getTime()
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000))
}

export function Customers() {
  const user = getSessionUser()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [form, setForm] = useState<FormState>({ ...emptyForm })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [orderFields, setOrderFields] = useState<OrderFieldConfig[]>([])
  const [currentPage, setCurrentPage] = useState(1)

  const [profileCustomer, setProfileCustomer] = useState<Customer | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileData, setProfileData] = useState<Customer360Result | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileTab, setProfileTab] = useState<CustomerProfileTab>('summary')
  const [historyPage, setHistoryPage] = useState(0)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [preferenceDraft, setPreferenceDraft] = useState('')
  const [savingPreferences, setSavingPreferences] = useState(false)
  const [printSettings, setPrintSettings] = useState({ receiptFontSize: 11, receiptPaperWidth: 58 as 58 | 80 | 88 })

  const CUSTOMERS_PER_PAGE = 25
  const canExportCustomers = hasPermission(user, 'customers.export')
  const canViewSales = hasPermission(user, 'sales.view')
  const canManageCustomers = hasPermission(user, 'customers.manage')

  const load = async () => setCustomers(await getCustomers())
  useEffect(() => {
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const refreshCustomers = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void load() }, 120)
    }
    window.addEventListener('smaky-sync-change', refreshCustomers)
    window.addEventListener('storage', refreshCustomers)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('smaky-sync-change', refreshCustomers)
      window.removeEventListener('storage', refreshCustomers)
    }
  }, [])
  useEffect(() => {
    const refreshFields = () => { void getOrderFields().then(setOrderFields) }
    refreshFields()
    window.addEventListener('smaky-settings-change', refreshFields)
    return () => window.removeEventListener('smaky-settings-change', refreshFields)
  }, [])
  useEffect(() => {
    void getGeneralSettings().then(settings => setPrintSettings({
      receiptFontSize: settings.receiptFontSize || 11,
      receiptPaperWidth: settings.receiptPaperWidth || 58,
    })).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!profileOpen || !profileCustomer) return
    if (!canViewSales) { setProfileData(emptyProfileResult); setProfileLoading(false); return }
    let alive = true
    const refresh = async (quiet = false) => {
      if (!quiet) setProfileLoading(true)
      try {
        const result = await fetchCustomer360(profileCustomer.id, historyPage * PROFILE_PAGE_SIZE)
        if (!alive) return
        setProfileData(result)
        if (!quiet) setProfileError('')
      } catch (caught) {
        if (!alive) return
        setProfileError(caught instanceof Error ? caught.message : 'No se pudo cargar el perfil del cliente.')
      } finally {
        if (alive && !quiet) setProfileLoading(false)
      }
    }
    void refresh()
    return () => { alive = false }
  }, [profileOpen, profileCustomer?.id, historyPage, canViewSales])

  // Los cambios de ventas actualizan únicamente la ficha abierta. El RPC calcula
  // las estadísticas en Supabase y devuelve solo una página de historial.
  useEffect(() => {
    if (!profileOpen || !profileCustomer || !canViewSales || !supabase) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let active = true
    const refreshQuietly = async () => {
      try {
        const result = await fetchCustomer360(profileCustomer.id, historyPage * PROFILE_PAGE_SIZE)
        if (active) {
          setProfileData(result)
          setProfileError('')
        }
      } catch (caught) {
        if (active) setProfileError(caught instanceof Error ? caught.message : 'No se pudo actualizar el perfil.')
      }
    }
    const channel = supabase.channel(`customer-profile-${profileCustomer.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `customer_id=eq.${profileCustomer.id}` }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { void refreshQuietly() }, 250)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers', filter: `id=eq.${profileCustomer.id}` }, (payload: any) => {
        const rowData = payload?.new?.data && typeof payload.new.data === 'object' ? payload.new.data as Partial<Customer> : null
        if (rowData && active) {
          setProfileCustomer(current => current?.id === profileCustomer.id ? { ...current, ...rowData } : current)
          setCustomers(current => current.map(item => item.id === profileCustomer.id ? { ...item, ...rowData } : item))
        }
      })
      .subscribe()
    const fallback = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshQuietly() }, 45_000)
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      window.clearInterval(fallback)
      void supabase?.removeChannel(channel)
    }
  }, [profileOpen, profileCustomer?.id, historyPage, canViewSales])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(customer => customer.name.toLowerCase().includes(q) || customer.phone.includes(q))
  }, [customers, search])

  useEffect(() => { setCurrentPage(1) }, [search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / CUSTOMERS_PER_PAGE))
  const pageStart = (currentPage - 1) * CUSTOMERS_PER_PAGE
  const paginatedCustomers = filtered.slice(pageStart, pageStart + CUSTOMERS_PER_PAGE)

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  const exportCustomers = () => {
    if (!canExportCustomers || !customers.length) return
    const customFieldIds = orderFields.filter(field => !field.system).map(field => field.id)
    const customFieldLabels = new Map(orderFields.filter(field => !field.system).map(field => [field.id, field.label]))
    const headers = ['Nombre', 'Celular', 'Dirección', 'Observaciones', 'Preferencias confirmadas', ...customFieldIds.map(id => customFieldLabels.get(id) || id)]
    const escapeCsv = (value: unknown) => {
      const text = String(value ?? '')
      return /[";,\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const rows = customers.map(customer => [customer.name, customer.phone, customer.address, customer.notes, (customer.favoriteObservations || []).join(' | '), ...customFieldIds.map(id => customer.customFields?.[id] || '')])
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(escapeCsv).join(';')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Clientes_Smaky_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setMessage(`${customers.length} cliente${customers.length === 1 ? '' : 's'} exportado${customers.length === 1 ? '' : 's'} correctamente.`)
    setError('')
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm })
    setError('')
    setMessage('')
    setModalOpen(true)
  }

  const openEdit = (customer: Customer) => {
    setEditing(customer)
    setForm({ name: customer.name, phone: customer.phone, address: customer.address, notes: customer.notes, customFields: { ...(customer.customFields || {}) } })
    setError('')
    setMessage('')
    setModalOpen(true)
  }

  const openProfile = (customer: Customer) => {
    setProfileCustomer(customer)
    setProfileOpen(true)
    setProfileData(null)
    setProfileError('')
    setProfileTab('summary')
    setHistoryPage(0)
    setSelectedSale(null)
    setPreferenceDraft('')
  }

  const closeProfile = () => {
    setProfileOpen(false)
    setProfileCustomer(null)
    setProfileData(null)
    setSelectedSale(null)
    setProfileError('')
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
    setError('')
  }

  const save = async () => {
    if (!user || saving) return
    setSaving(true)
    setError('')
    try {
      const missing = orderFields.filter(field => field.enabled && field.required).find(field => {
        const value = field.system ? ({ name: form.name, phone: form.phone, address: form.address, notes: form.notes } as Record<string, string>)[field.id] : form.customFields[field.id]
        return !String(value || '').trim()
      })
      if (missing) throw new Error(`Completa el campo “${missing.label}”.`)
      if (editing) await updateCustomer(editing.id, form, user)
      else await createCustomer(form, user)
      await load()
      setMessage(editing ? 'Cliente actualizado.' : 'Cliente agregado.')
      setModalOpen(false)
      if (editing && profileCustomer?.id === editing.id) setProfileCustomer({ ...profileCustomer, ...form, updatedAt: new Date().toISOString() })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar el cliente.')
    } finally { setSaving(false) }
  }

  const remove = async (customer: Customer) => {
    if (!user || saving) return
    if (!window.confirm(`¿Quitar a ${customer.name} de clientes? Su historial de ventas se conservará.`)) return
    setSaving(true)
    setError('')
    try {
      await deactivateCustomer(customer.id, user)
      await load()
      if (profileCustomer?.id === customer.id) closeProfile()
      setMessage('Cliente retirado.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible retirar el cliente.')
    } finally { setSaving(false) }
  }

  const persistPreferences = async (nextValues: string[]) => {
    if (!user || !profileCustomer || savingPreferences) return
    const uniqueMap = new Map<string, string>()
    for (const rawValue of nextValues) {
      const value = normalizePreference(rawValue)
      const key = preferenceKey(value)
      if (key && !uniqueMap.has(key)) uniqueMap.set(key, value)
    }
    const unique = Array.from(uniqueMap.values()).slice(0, 30)
    setSavingPreferences(true)
    setProfileError('')
    try {
      const updated = await updateCustomer(profileCustomer.id, {
        name: profileCustomer.name,
        phone: profileCustomer.phone,
        address: profileCustomer.address,
        notes: profileCustomer.notes,
        customFields: profileCustomer.customFields || {},
        favoriteObservations: unique,
      }, user)
      if (!updated) throw new Error('No se encontró el cliente para guardar sus preferencias.')
      setProfileCustomer(updated)
      setCustomers(current => current.map(item => item.id === updated.id ? updated : item))
      setPreferenceDraft('')
    } catch (caught) {
      setProfileError(caught instanceof Error ? caught.message : 'No se pudieron guardar las preferencias.')
    } finally { setSavingPreferences(false) }
  }

  const togglePreference = (value: string) => {
    if (!profileCustomer) return
    const key = preferenceKey(value)
    const existing = profileCustomer.favoriteObservations || []
    const next = existing.some(item => preferenceKey(item) === key)
      ? existing.filter(item => preferenceKey(item) !== key)
      : [...existing, normalizePreference(value)]
    void persistPreferences(next)
  }

  const printInvoice = (sale: Sale) => {
    const success = printSaleReceipt(sale, printSettings.receiptFontSize, 'COPIA', printSettings.receiptPaperWidth)
    if (!success) setProfileError('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para imprimir la factura.')
  }

  const summary = profileData?.summary || emptyProfileResult.summary
  const confirmedPreferences = profileCustomer?.favoriteObservations || []
  const daysFromLastPurchase = daysSince(summary.lastPurchaseAt)
  const customerStatus = daysFromLastPurchase !== null && daysFromLastPurchase >= 30
    ? { label: 'Sin visitas recientes', className: 'lapsed' }
    : summary.totalSales >= 10
      ? { label: 'Cliente frecuente', className: 'high' }
      : summary.totalSales >= 4
        ? { label: 'Cliente recurrente', className: 'returning' }
        : summary.totalSales > 0
          ? { label: 'Con compras', className: '' }
          : { label: 'Sin compras todavía', className: '' }

  return <div className="customers-page">
    <header className="page-heading compact customers-heading">
      <div><p className="eyebrow">CLIENTES</p><h1>Clientes</h1><p className="muted">Abre un cliente para consultar su historial, hábitos de compra y preferencias.</p></div>
      <div className="customers-heading-actions">{canExportCustomers && <button className="secondary" onClick={exportCustomers} disabled={!customers.length} title="Exportar todos los clientes a CSV compatible con Excel"><Download size={16}/> Exportar</button>}<button className="primary-inline" onClick={openCreate}><Plus size={16}/> Nuevo cliente</button></div>
    </header>

    {(error || message) && <div className={`customers-feedback ${error ? 'error' : 'success'}`}>{error || message}<button onClick={() => { setError(''); setMessage('') }} aria-label="Cerrar">×</button></div>}

    <section className="customers-panel">
      <div className="customers-toolbar">
        <label className="customers-search"><Search size={17}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nombre o celular…" inputMode="search"/><kbd>Ctrl K</kbd></label>
        <span className="customers-count"><b>{filtered.length}</b> de {customers.length} clientes</span>
      </div>
      <div className="customers-list">
        {!filtered.length ? <div className="customers-empty"><div className="customers-empty-icon"><UserRound size={24}/></div><b>{customers.length ? 'No encontramos clientes' : 'Aún no hay clientes'}</b><span>{customers.length ? 'Prueba con otro nombre o número.' : 'Agrega el primer cliente para empezar.'}</span><button className="primary-inline" onClick={openCreate}><Plus size={15}/> Agregar cliente</button></div> : paginatedCustomers.map(customer => <article className="customer-row" key={customer.id}>
          <button type="button" className="customer-profile-trigger" onClick={() => openProfile(customer)} aria-label={`Abrir perfil de ${customer.name}`}>
            <div className="customer-avatar"><UserRound size={18}/></div>
            <div className="customer-main"><b>{customer.name}</b><span><Phone size={13}/> {customer.phone}</span>{customer.address && <span><MapPin size={13}/> {customer.address}</span>}</div>
            <ChevronRight className="customer-open-chevron" size={17}/>
          </button>
          <div className="customer-actions"><button className="customer-action" onClick={() => openEdit(customer)} aria-label={`Editar ${customer.name}`} title="Editar"><Pencil size={15}/></button><button className="customer-action danger" onClick={() => void remove(customer)} aria-label={`Quitar ${customer.name}`} title="Quitar"><Trash2 size={15}/></button></div>
        </article>)}
      </div>
      {filtered.length > CUSTOMERS_PER_PAGE && <nav className="customers-pagination" aria-label="Paginación de clientes">
        <span className="customers-page-summary">Mostrando {pageStart + 1}–{Math.min(pageStart + CUSTOMERS_PER_PAGE, filtered.length)} de {filtered.length}</span>
        <div className="customers-page-controls">
          <button className="customers-page-btn" onClick={() => setCurrentPage(page => Math.max(1, page - 1))} disabled={currentPage === 1} aria-label="Página anterior"><ChevronLeft size={16}/></button>
          {Array.from({ length: totalPages }, (_, index) => index + 1).map(page => <button key={page} className={`customers-page-btn ${page === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(page)} aria-current={page === currentPage ? 'page' : undefined}>{page}</button>)}
          <button className="customers-page-btn" onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages} aria-label="Página siguiente"><ChevronRight size={16}/></button>
        </div>
      </nav>}
    </section>

    {modalOpen && <div className={`customer-modal-backdrop ${profileOpen ? 'customer-modal-from-profile' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) closeModal() }}>
      <section className="customer-modal" role="dialog" aria-modal="true" aria-labelledby="customer-modal-title">
        <header className="customer-modal-head"><div><span className="eyebrow">CLIENTE</span><h2 id="customer-modal-title">{editing ? 'Editar cliente' : 'Agregar cliente'}</h2><p>El celular identifica al cliente.</p></div><button className="item-editor-close" onClick={closeModal} aria-label="Cerrar"><X size={18}/></button></header>
        <div className="customer-form">
          {orderFields.filter(field => field.enabled).map((field, index) => {
            const value = field.system ? ({ name: form.name, phone: form.phone, address: form.address, notes: form.notes } as Record<string, string>)[field.id] || '' : form.customFields[field.id] || ''
            const setValue = (next: string) => setForm(current => field.system ? { ...current, [field.id]: next } : { ...current, customFields: { ...current.customFields, [field.id]: next } })
            const wide = field.type === 'textarea' || field.type === 'address' || field.id === 'address'
            const commonProps = { autoFocus: index === 0, value, onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValue(event.target.value) }
            return <label className={wide ? 'customer-field-wide' : ''} key={field.id}><span>{field.label}{field.required ? ' · Obligatorio' : ''}</span>{field.type === 'textarea' ? <textarea {...commonProps} placeholder={field.id === 'notes' ? 'Ej. Casa azul, toca el timbre…' : 'Escribe aquí…'}/> : field.type === 'select' ? <select {...commonProps}><option value="">Selecciona una opción…</option>{(field.options || []).map(option => <option value={option} key={option}>{option}</option>)}</select> : <input {...commonProps} type={field.type === 'number' ? 'number' : field.type === 'phone' ? 'tel' : 'text'} placeholder={field.type === 'phone' ? '300 000 0000' : field.type === 'address' || field.id === 'address' ? 'Dirección de entrega' : field.id === 'name' ? 'Nombre completo' : 'Escribe aquí…'} inputMode={field.type === 'number' ? 'decimal' : field.type === 'phone' ? 'tel' : undefined}/>}</label>
          })}
          {error && <div className="customers-feedback error">{error}</div>}
        </div>
        <footer className="customer-modal-foot"><button className="secondary" disabled={saving} onClick={closeModal}>Cancelar</button><button className="primary" disabled={saving || !form.name.trim() || !form.phone.trim()} onClick={() => void save()}>{saving ? 'Guardando…' : editing ? <><Check size={15}/> Guardar</> : <><Plus size={15}/> Agregar cliente</>}</button></footer>
      </section>
    </div>}

    {profileOpen && profileCustomer && <div className="customer-profile-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeProfile() }}>
      <section className="customer-profile-modal" role="dialog" aria-modal="true" aria-labelledby="customer-profile-title">
        <header className="customer-profile-header">
          <div className="customer-profile-heading-person">
            <div className="customer-profile-avatar"><UserRound size={27}/></div>
            <div className="customer-profile-title-copy">
              <span className="eyebrow">PERFIL 360°</span>
              <h2 id="customer-profile-title">{profileCustomer.name}</h2>
              <div className="customer-profile-contact"><span><Phone size={13}/>{profileCustomer.phone}</span>{profileCustomer.address && <span><MapPin size={13}/>{profileCustomer.address}</span>}{profileData?.canViewPurchases && <span className={`customer-profile-loyalty ${customerStatus.className}`}><Star size={12}/>{customerStatus.label}</span>}</div>
            </div>
          </div>
          <div className="customer-profile-header-actions">
            <button className="secondary" onClick={() => openEdit(profileCustomer)}><Pencil size={15}/> Editar cliente</button>
            <button className="customer-profile-close" onClick={closeProfile} aria-label="Cerrar perfil"><X size={19}/></button>
          </div>
        </header>

        {profileError && <div className="customers-feedback error customer-profile-feedback">{profileError}<button onClick={() => setProfileError('')} aria-label="Cerrar">×</button></div>}

        {canViewSales ? <>
          <div className="customer-profile-metrics">
            <div className="customer-profile-metric"><span><Wallet size={15}/> Total comprado</span><strong>{money(summary.totalSpent)}</strong><small>Compras válidas</small></div>
            <div className="customer-profile-metric"><span><ShoppingBag size={15}/> Pedidos pagados</span><strong>{summary.totalSales}</strong><small>Ventas no eliminadas</small></div>
            <div className="customer-profile-metric"><span><Tag size={15}/> Compra promedio</span><strong>{money(summary.averageTicket)}</strong><small>Por venta</small></div>
            <div className="customer-profile-metric"><span><Clock3 size={15}/> Última compra</span><strong>{daysFromLastPurchase === null ? 'Sin compras' : daysFromLastPurchase === 0 ? 'Hoy' : `Hace ${daysFromLastPurchase} día${daysFromLastPurchase === 1 ? '' : 's'}`}</strong><small>{summary.lastPurchaseAt ? dateTime(summary.lastPurchaseAt) : 'Aún no tiene ventas'}</small></div>
          </div>
          <nav className="customer-profile-tabs" aria-label="Secciones del perfil del cliente">
            <button className={profileTab === 'summary' ? 'active' : ''} onClick={() => { setHistoryPage(0); setProfileTab('summary') }}><Sparkles size={15}/> Resumen</button>
            <button className={profileTab === 'history' ? 'active' : ''} onClick={() => { setHistoryPage(0); setProfileTab('history') }}><ReceiptText size={15}/> Pedidos y facturas</button>
            <button className={profileTab === 'preferences' ? 'active' : ''} onClick={() => setProfileTab('preferences')}><Heart size={15}/> Preferencias</button>
            <button className={profileTab === 'details' ? 'active' : ''} onClick={() => setProfileTab('details')}><UserRound size={15}/> Datos</button>
            <button className="customer-profile-refresh" onClick={() => { setProfileLoading(true); void fetchCustomer360(profileCustomer.id, historyPage * PROFILE_PAGE_SIZE).then(setProfileData).catch(caught => setProfileError(caught instanceof Error ? caught.message : 'No se pudo actualizar el perfil.')).finally(() => setProfileLoading(false)) }} title="Actualizar datos"><RefreshCw size={15}/></button>
          </nav>
          <div className="customer-profile-body">
            {profileLoading && !profileData ? <div className="customer-profile-loading"><RefreshCw size={20} className="customer-profile-spin"/><span>Cargando información de Supabase…</span></div> : !profileData?.canViewPurchases ? <div className="customer-profile-restricted"><Eye size={25}/><b>No tienes permiso para ver las compras</b><span>El perfil del cliente está disponible, pero las estadísticas y facturas requieren el permiso «Ver ventas».</span></div> : <>
              {profileTab === 'summary' && <div className="customer-profile-summary-grid">
                <section className="customer-profile-card customer-profile-products-card">
                  <div className="customer-profile-card-head"><div><h3>Productos favoritos</h3><p>Lo que más compra, por cantidad de unidades.</p></div><Star size={18}/></div>
                  {profileData.favoriteProducts.length ? <div className="customer-profile-favorite-list">{profileData.favoriteProducts.slice(0, 5).map((product, index) => {
                    const max = Math.max(1, ...profileData.favoriteProducts.map(item => Number(item.quantity) || 0))
                    return <div className="customer-profile-favorite" key={`${product.productId}-${product.name}`}><div className="customer-profile-favorite-top"><span className="customer-profile-rank">{index + 1}</span><b>{product.name}</b><strong>{product.quantity} ud.</strong></div><div className="customer-profile-bar"><span style={{ width: `${Math.max(3, (Number(product.quantity) / max) * 100)}%` }}/></div><small>{product.orders} venta{product.orders === 1 ? '' : 's'} · {money(product.totalSpent)}</small></div>
                  })}</div> : <div className="customer-profile-empty"><ShoppingBag size={23}/><span>Cuando tenga compras, aquí verás sus productos favoritos.</span></div>}
                </section>
                <section className="customer-profile-card customer-profile-observations-card">
                  <div className="customer-profile-card-head"><div><h3>Observaciones recurrentes</h3><p>Indicaciones repetidas en sus productos.</p></div><Heart size={18}/></div>
                  {profileData.frequentObservations.length ? <div className="customer-profile-observation-list">{profileData.frequentObservations.slice(0, 8).map(observation => {
                    const saved = confirmedPreferences.some(item => preferenceKey(item) === preferenceKey(observation.text))
                    return <div className="customer-profile-observation" key={observation.text}><div><b>{observation.text}</b><small>{observation.count} vez{observation.count === 1 ? '' : 'es'}</small></div><button className={saved ? 'saved' : ''} disabled={savingPreferences} onClick={() => togglePreference(observation.text)}>{saved ? <><Check size={13}/> Guardada</> : <><Plus size={13}/> Guardar</>}</button></div>
                  })}</div> : <div className="customer-profile-empty"><Heart size={23}/><span>Las observaciones frecuentes aparecerán cuando existan pedidos con indicaciones.</span></div>}
                  <div className="customer-profile-confirmed"><span>Preferencias confirmadas</span>{confirmedPreferences.length ? <div className="customer-profile-tags">{confirmedPreferences.map(preference => <button key={preference} title="Quitar preferencia" onClick={() => togglePreference(preference)} disabled={savingPreferences}>{preference}<X size={12}/></button>)}</div> : <small>Aún no hay preferencias confirmadas.</small>}</div>
                </section>
                <section className="customer-profile-card customer-profile-recent-card">
                  <div className="customer-profile-card-head"><div><h3>Últimas compras</h3><p>Facturas más recientes de este cliente.</p></div><button className="customer-profile-link" onClick={() => setProfileTab('history')}>Ver todas <ArrowUpRight size={14}/></button></div>
                  {profileData.sales.length ? <div className="customer-profile-recent-list">{profileData.sales.slice(0, 4).map(sale => <div className="customer-profile-recent-sale" key={sale.id}><div className="customer-profile-recent-icon"><ReceiptText size={16}/></div><div className="customer-profile-recent-info"><b>Factura {sale.orderNumber ?? sale.id.slice(-6).toUpperCase()}</b><span>{dateTime(sale.createdAt)} · {sale.items?.length || 0} líneas</span></div><strong>{money(sale.total)}</strong><button onClick={() => setSelectedSale(sale)} aria-label="Ver factura" title="Ver factura"><Eye size={15}/></button></div>)}</div> : <div className="customer-profile-empty compact"><span>Este cliente todavía no tiene ventas registradas.</span></div>}
                </section>
              </div>}

              {profileTab === 'history' && <section className="customer-profile-card customer-profile-history-card"><div className="customer-profile-card-head"><div><h3>Pedidos y facturas</h3><p>Historial paginado de ventas válidas del cliente.</p></div><span className="customer-profile-history-count">{summary.totalSales} ventas</span></div>
                {profileData.sales.length ? <div className="customer-profile-history-list">{profileData.sales.map(sale => <article className="customer-profile-history-row" key={sale.id}><div className="customer-profile-history-date"><CalendarDays size={15}/><span>{dateTime(sale.createdAt)}</span></div><div className="customer-profile-history-main"><b>Factura {sale.orderNumber ?? sale.id.slice(-6).toUpperCase()}</b><span>{(sale.items || []).map(item => `${item.quantity}× ${item.name}`).join(' · ') || 'Detalle no disponible'}</span>{sale.notes?.trim() && <small>Observaciones del cliente: {sale.notes}</small>}</div><div className="customer-profile-history-total"><strong>{money(sale.total)}</strong><small>{sale.paymentLabel || sale.payment || 'Pago'}</small></div><button className="customer-profile-invoice-button" onClick={() => setSelectedSale(sale)}><Eye size={15}/> Factura</button><button className="customer-profile-print-button" onClick={() => printInvoice(sale)} title="Imprimir copia"><Printer size={15}/></button></article>)}</div> : <div className="customer-profile-empty"><ReceiptText size={25}/><span>No hay ventas válidas asociadas a este cliente.</span></div>}
                <div className="customer-profile-history-pagination"><span>Página {historyPage + 1}</span><div><button className="secondary" disabled={historyPage === 0 || profileLoading} onClick={() => setHistoryPage(page => Math.max(0, page - 1))}><ChevronLeft size={15}/> Anterior</button><button className="secondary" disabled={!profileData.hasMore || profileLoading} onClick={() => setHistoryPage(page => page + 1)}>Siguiente <ChevronRight size={15}/></button></div></div>
              </section>}

              {profileTab === 'preferences' && <div className="customer-profile-summary-grid"><section className="customer-profile-card customer-profile-preferences-card"><div className="customer-profile-card-head"><div><h3>Preferencias del cliente</h3><p>Guarda gustos confirmados para futuras visitas.</p></div><Heart size={18}/></div><form className="customer-profile-add-preference" onSubmit={event => { event.preventDefault(); if (normalizePreference(preferenceDraft)) togglePreference(preferenceDraft) }}><input value={preferenceDraft} onChange={event => setPreferenceDraft(event.target.value)} placeholder="Ej. Sin cebolla, extra queso…" maxLength={100}/><button className="primary-inline" type="submit" disabled={!normalizePreference(preferenceDraft) || savingPreferences}><Plus size={15}/> Añadir</button></form><div className="customer-profile-tags roomy">{confirmedPreferences.length ? confirmedPreferences.map(preference => <button key={preference} onClick={() => togglePreference(preference)} disabled={savingPreferences}>{preference}<X size={13}/></button>) : <span className="customer-profile-muted">Todavía no hay preferencias confirmadas.</span>}</div></section><section className="customer-profile-card"><div className="customer-profile-card-head"><div><h3>Sugerencias del historial</h3><p>No se guardan automáticamente; tú las confirmas.</p></div><Sparkles size={18}/></div>{profileData.frequentObservations.length ? <div className="customer-profile-observation-list">{profileData.frequentObservations.map(observation => { const saved = confirmedPreferences.some(item => preferenceKey(item) === preferenceKey(observation.text)); return <div className="customer-profile-observation" key={observation.text}><div><b>{observation.text}</b><small>{observation.count} repetición(es)</small></div><button className={saved ? 'saved' : ''} onClick={() => togglePreference(observation.text)} disabled={saved || savingPreferences}>{saved ? <><Check size={13}/> Guardada</> : <><Plus size={13}/> Confirmar</>}</button></div> })}</div> : <div className="customer-profile-empty"><Heart size={22}/><span>No se han detectado observaciones repetidas.</span></div>}</section></div>}

              {profileTab === 'details' && <section className="customer-profile-card customer-profile-details-card"><div className="customer-profile-card-head"><div><h3>Información del cliente</h3><p>Datos guardados en la ficha del cliente.</p></div><button className="secondary" onClick={() => openEdit(profileCustomer)}><Pencil size={14}/> Editar datos</button></div><div className="customer-profile-detail-grid"><div><span>Nombre</span><b>{profileCustomer.name || '—'}</b></div><div><span>Celular</span><b>{profileCustomer.phone || '—'}</b></div><div className="wide"><span>Dirección</span><b>{profileCustomer.address || 'No registrada'}</b></div><div className="wide"><span>Observaciones del cliente</span><p>{profileCustomer.notes || 'Sin observaciones registradas.'}</p></div>{orderFields.filter(field => !field.system && String(profileCustomer.customFields?.[field.id] || '').trim()).map(field => <div className="wide" key={field.id}><span>{field.label}</span><b>{profileCustomer.customFields?.[field.id]}</b></div>)}<div><span>Cliente registrado</span><b>{dateTime(profileCustomer.createdAt)}</b></div><div><span>Primera compra</span><b>{dateTime(summary.firstPurchaseAt)}</b></div><div><span>Última actualización</span><b>{dateTime(profileCustomer.updatedAt)}</b></div></div></section>}
            </>}
          </div>
        </> : <div className="customer-profile-restricted large"><Eye size={25}/><b>Perfil de cliente</b><span>Tu usuario puede administrar los datos del cliente, pero necesita el permiso «Ver ventas» para consultar compras, estadísticas y facturas.</span></div>}
      </section>
    </div>}

    {selectedSale && <div className="customer-invoice-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedSale(null) }}><section className="customer-invoice-modal" role="dialog" aria-modal="true" aria-labelledby="customer-invoice-title"><header><div><span className="eyebrow">FACTURA DEL CLIENTE</span><h3 id="customer-invoice-title">Factura {selectedSale.orderNumber ?? selectedSale.id.slice(-6).toUpperCase()}</h3><p>{dateTime(selectedSale.createdAt)}</p></div><button className="customer-profile-close" onClick={() => setSelectedSale(null)} aria-label="Cerrar factura"><X size={18}/></button></header><div className="customer-invoice-body"><div className="customer-invoice-meta"><span>Atendido por</span><b>{selectedSale.userName || '—'}</b><span>Medio de pago</span><b>{selectedSale.paymentLabel || selectedSale.payment || '—'}</b></div>{(selectedSale.items || []).map((item, index) => <div className="customer-invoice-item" key={`${item.productId}-${index}`}><div><b>{item.quantity}× {item.name}</b>{item.modification && <small>{item.modification}</small>}</div><strong>{money(item.total)}</strong></div>)}{selectedSale.notes?.trim() && <div className="customer-invoice-note"><span>Observaciones del cliente</span><p>{selectedSale.notes}</p></div>}<div className="customer-invoice-total"><span>Total</span><strong>{money(selectedSale.total)}</strong></div></div><footer><button className="secondary" onClick={() => setSelectedSale(null)}>Cerrar</button><button className="primary-inline" onClick={() => printInvoice(selectedSale)}><Printer size={15}/> Imprimir copia</button></footer></section></div>}
  </div>
}
