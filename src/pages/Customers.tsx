import { Check, MapPin, Pencil, Phone, Plus, Search, Trash2, UserRound, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getSessionUser } from '../lib/auth'
import { createCustomer, deactivateCustomer, getCustomers, updateCustomer } from '../lib/store'
import type { Customer } from '../lib/types'

const emptyForm = { name: '', phone: '', address: '', notes: '' }
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

  const load = async () => setCustomers(await getCustomers())
  useEffect(() => { void load() }, [])

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
    setForm({ name: customer.name, phone: customer.phone, address: customer.address, notes: customer.notes })
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
          <label><span>Nombre</span><input autoFocus value={form.name} onChange={event => setForm(v => ({ ...v, name: event.target.value }))} placeholder="Nombre completo"/></label>
          <label><span>Celular</span><input value={form.phone} onChange={event => setForm(v => ({ ...v, phone: event.target.value }))} placeholder="300 000 0000" inputMode="tel"/></label>
          <label className="customer-field-wide"><span>Dirección</span><input value={form.address} onChange={event => setForm(v => ({ ...v, address: event.target.value }))} placeholder="Dirección de entrega"/></label>
          <label className="customer-field-wide"><span>Observaciones</span><textarea value={form.notes} onChange={event => setForm(v => ({ ...v, notes: event.target.value }))} placeholder="Ej. Casa azul, toca el timbre…"/></label>
          {error && <div className="customers-feedback error">{error}</div>}
        </div>
        <footer className="customer-modal-foot"><button className="secondary" disabled={saving} onClick={closeModal}>Cancelar</button><button className="primary" disabled={saving || !form.name.trim() || !form.phone.trim()} onClick={() => void save()}>{saving ? 'Guardando…' : editing ? <><Check size={15}/> Guardar</> : <><Plus size={15}/> Agregar cliente</>}</button></footer>
      </section>
    </div>}
  </div>
}
