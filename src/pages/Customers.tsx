import { Check, MapPin, Pencil, Phone, Plus, Search, Trash2, UserRound, X } from 'lucide-react'
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

  const load = async () => setCustomers(await getCustomers())
  useEffect(() => { void load() }, [])
  useEffect(() => { const refreshFields = () => { void getOrderFields().then(setOrderFields) }; refreshFields(); window.addEventListener('smaky-settings-change', refreshFields); return () => window.removeEventListener('smaky-settings-change', refreshFields) }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers
    return customers.filter(customer => customer.name.toLowerCase().includes(q) || customer.phone.includes(q))
  }, [customers, search])

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
      <button className="primary-inline" onClick={openCreate}><Plus size={16}/> Nuevo cliente</button>
    </header>

    {(error || message) && <div className={`customers-feedback ${error ? 'error' : 'success'}`}>{error || message}<button onClick={() => { setError(''); setMessage('') }} aria-label="Cerrar">×</button></div>}

    <section className="customers-panel">
      <div className="customers-toolbar">
        <label className="customers-search"><Search size={17}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nombre o celular…" inputMode="search"/><kbd>Ctrl K</kbd></label>
        <span className="customers-count"><b>{filtered.length}</b> de {customers.length}</span>
      </div>
      <div className="customers-list">
        {!filtered.length ? <div className="customers-empty"><div className="customers-empty-icon"><UserRound size={24}/></div><b>{customers.length ? 'No encontramos clientes' : 'Aún no hay clientes'}</b><span>{customers.length ? 'Prueba con otro nombre o número.' : 'Agrega el primer cliente para empezar.'}</span><button className="primary-inline" onClick={openCreate}><Plus size={15}/> Agregar cliente</button></div> : filtered.map(customer => <article className="customer-row" key={customer.id}>
          <div className="customer-avatar"><UserRound size={18}/></div>
          <div className="customer-main"><b>{customer.name}</b><span><Phone size={13}/> {customer.phone}</span>{customer.address && <span><MapPin size={13}/> {customer.address}</span>}</div>
          <div className="customer-actions"><button className="customer-action" onClick={() => openEdit(customer)} aria-label={`Editar ${customer.name}`} title="Editar"><Pencil size={15}/></button><button className="customer-action danger" onClick={() => void remove(customer)} aria-label={`Quitar ${customer.name}`} title="Quitar"><Trash2 size={15}/></button></div>
        </article>)}
      </div>
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
