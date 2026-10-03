import { Check, ChevronLeft, ChevronRight, Download, MapPin, Pencil, Phone, Plus, Search, Trash2, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { getSessionUser } from '../lib/auth'
import { createCustomer, deactivateCustomer, getCustomers, getOrderFields, updateCustomer } from '../lib/store'
import type { Customer, OrderFieldConfig } from '../lib/types'

const emptyForm = { name: '', phone: '', address: '', notes: '', customFields: {} as Record<string, string> }
type FormState = typeof emptyForm

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

  const CUSTOMERS_PER_PAGE = 25

  const load = async () => setCustomers(await getCustomers())
  useEffect(() => { void load() }, [])
  useEffect(() => { const refreshFields = () => { void getOrderFields().then(setOrderFields) }; refreshFields(); window.addEventListener('smaky-settings-change', refreshFields); return () => window.removeEventListener('smaky-settings-change', refreshFields) }, [])

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
    if (!customers.length) return

    const customFieldIds = orderFields.filter(field => !field.system).map(field => field.id)
    const customFieldLabels = new Map(orderFields.filter(field => !field.system).map(field => [field.id, field.label]))
    const headers = ['Nombre', 'Celular', 'Dirección', 'Observaciones', ...customFieldIds.map(id => customFieldLabels.get(id) || id)]

    const escapeCsv = (value: unknown) => {
      const text = String(value ?? '')
      return /[";,\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }

    const rows = customers.map(customer => [
      customer.name,
      customer.phone,
      customer.address,
      customer.notes,
      ...customFieldIds.map(id => customer.customFields?.[id] || ''),
    ])

    // CSV UTF-8 con BOM: Excel lo abre correctamente conservando tildes y caracteres especiales.
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
      const missing = orderFields.filter(field => field.enabled && field.required).find(field => { const value = field.system ? ({ name: form.name, phone: form.phone, address: form.address, notes: form.notes } as Record<string, string>)[field.id] : form.customFields[field.id]; return !String(value || '').trim() })
      if (missing) throw new Error(`Completa el campo “${missing.label}”.`)
      if (editing) await updateCustomer(editing.id, form, user)
      else await createCustomer(form, user)
      await load()
      setMessage(editing ? 'Cliente actualizado.' : 'Cliente agregado.')
      setModalOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar el cliente.')
    } finally { setSaving(false) }
  }

  const remove = async (customer: Customer) => {
    if (!user || saving) return
    if (!window.confirm(`¿Quitar a ${customer.name} de clientes?`)) return
    setSaving(true)
    setError('')
    try {
      await deactivateCustomer(customer.id, user)
      await load()
      setMessage('Cliente retirado.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible retirar el cliente.')
    } finally { setSaving(false) }
  }

  return <div className="customers-page">
    <header className="page-heading compact customers-heading">
      <div><p className="eyebrow">CLIENTES</p><h1>Clientes</h1><p className="muted">Busca por celular, selecciona un cliente y reutiliza sus datos al registrar pedidos.</p></div>
      <div className="customers-heading-actions"><button className="secondary" onClick={exportCustomers} disabled={!customers.length} title="Exportar todos los clientes a CSV compatible con Excel"><Download size={16}/> Exportar</button><button className="primary-inline" onClick={openCreate}><Plus size={16}/> Nuevo cliente</button></div>
    </header>

    {(error || message) && <div className={`customers-feedback ${error ? 'error' : 'success'}`}>{error || message}<button onClick={() => { setError(''); setMessage('') }} aria-label="Cerrar">×</button></div>}

    <section className="customers-panel">
      <div className="customers-toolbar">
        <label className="customers-search"><Search size={17}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nombre o celular…" inputMode="search"/><kbd>Ctrl K</kbd></label>
        <span className="customers-count"><b>{filtered.length}</b> de {customers.length} clientes</span>
      </div>
      <div className="customers-list">
        {!filtered.length ? <div className="customers-empty"><div className="customers-empty-icon"><UserRound size={24}/></div><b>{customers.length ? 'No encontramos clientes' : 'Aún no hay clientes'}</b><span>{customers.length ? 'Prueba con otro nombre o número.' : 'Agrega el primer cliente para empezar.'}</span><button className="primary-inline" onClick={openCreate}><Plus size={15}/> Agregar cliente</button></div> : paginatedCustomers.map(customer => <article className="customer-row" key={customer.id}>
          <div className="customer-avatar"><UserRound size={18}/></div>
          <div className="customer-main"><b>{customer.name}</b><span><Phone size={13}/> {customer.phone}</span>{customer.address && <span><MapPin size={13}/> {customer.address}</span>}</div>
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

    {modalOpen && <div className="customer-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeModal() }}>
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
  </div>
}
