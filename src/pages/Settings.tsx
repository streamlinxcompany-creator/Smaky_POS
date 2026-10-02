import { Banknote, Check, ChevronRight, CreditCard, Pencil, Plus, Settings2, ShieldCheck, Tag, Trash2, WalletCards, Users as UsersIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getSessionUser } from '../lib/auth'
import { addPaymentMethod, addProductCategory, DEFAULT_PRODUCT_CATEGORIES, deletePaymentMethod, deleteProductCategory, getAllProducts, getPaymentMethods, getProductCategories, updatePaymentMethod, updateProductCategory } from '../lib/store'
import type { PaymentMethodConfig } from '../lib/types'
import { Users } from './Users'

type SettingsSection = 'general' | 'payments' | 'categories' | 'users'

const paymentIcon = (id: string) => id === 'cash' ? Banknote : id === 'transfer' ? WalletCards : CreditCard

const sectionMeta: Array<{ id: SettingsSection; label: string; description: string }> = [
  { id: 'general', label: 'General', description: 'Resumen' },
  { id: 'payments', label: 'Medios de pago', description: 'Cobros' },
  { id: 'categories', label: 'Categorías', description: 'Productos' },
]

export function Settings() {
  const user = getSessionUser()
  const [section, setSection] = useState<SettingsSection>('general')
  const [categories, setCategories] = useState<string[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>([])
  const [products, setProducts] = useState<Awaited<ReturnType<typeof getAllProducts>>>([])
  const [categoryName, setCategoryName] = useState('')
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [paymentName, setPaymentName] = useState('')
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null)
  const [editingPaymentName, setEditingPaymentName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const canManage = !!user && ['manager', 'admin'].includes(user.role)
  const isManager = user?.role === 'manager'

  const load = async () => {
    const [nextCategories, nextProducts, methods] = await Promise.all([getProductCategories(), getAllProducts(), getPaymentMethods()])
    setCategories(nextCategories)
    setProducts(nextProducts)
    setPaymentMethods(methods)
  }

  useEffect(() => { void load() }, [])

  const clearFeedback = () => { setError(''); setMessage('') }
  const flashError = (caught: unknown) => setError(caught instanceof Error ? caught.message : 'No fue posible guardar el cambio.')

  const addCategory = async () => {
    if (!user || !canManage || saving) return
    setSaving(true); clearFeedback()
    try {
      setCategories(await addProductCategory(categoryName, user))
      setCategoryName('')
      setMessage('Categoría agregada.')
    } catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const startCategoryEdit = (name: string) => { setEditingCategory(name); setEditingCategoryName(name); clearFeedback() }

  const saveCategory = async (oldName: string) => {
    if (!user || !canManage || saving) return
    setSaving(true); clearFeedback()
    try {
      setCategories(await updateProductCategory(oldName, editingCategoryName, user))
      setEditingCategory(null)
      setEditingCategoryName('')
      await load()
      setMessage('Categoría actualizada.')
    } catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const removeCategory = async (name: string) => {
    if (!user || !canManage || saving) return
    if (!window.confirm(`¿Eliminar “${name}”?`)) return
    setSaving(true); clearFeedback()
    try { setCategories(await deleteProductCategory(name, user)); setMessage('Categoría eliminada.') }
    catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const addPayment = async () => {
    if (!user || !canManage || saving) return
    setSaving(true); clearFeedback()
    try { setPaymentMethods(await addPaymentMethod(paymentName, user)); setPaymentName(''); setMessage('Medio de pago agregado.') }
    catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const savePayment = async (method: PaymentMethodConfig) => {
    if (!user || !canManage || saving) return
    setSaving(true); clearFeedback()
    try { setPaymentMethods(await updatePaymentMethod(method.id, editingPaymentName, user)); setEditingPaymentId(null); setEditingPaymentName(''); setMessage('Medio de pago actualizado.') }
    catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const removePayment = async (method: PaymentMethodConfig) => {
    if (!user || !canManage || saving) return
    if (!window.confirm(`¿Quitar “${method.name}”?`)) return
    setSaving(true); clearFeedback()
    try { setPaymentMethods(await deletePaymentMethod(method.id, user)); setMessage('Medio de pago retirado.') }
    catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const categoryCounts = useMemo(() => products.reduce<Record<string, number>>((acc, product) => {
    const key = product.category
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}), [products])

  if (!user || !canManage) return null

  const activeSection = isManager || section !== 'users' ? section : 'general'
  const contentTitle = activeSection === 'general' ? 'General' : activeSection === 'payments' ? 'Medios de pago' : activeSection === 'categories' ? 'Categorías' : 'Usuarios'

  return <div className="settings-page">
    <aside className="settings-sidebar">
      <div className="settings-brand-row"><div className="settings-brand-icon"><Settings2 size={16}/></div><div><h1>Configuraciones</h1><span>Smaky POS</span></div></div>
      <div className="settings-nav">
        {sectionMeta.map(item => <button key={item.id} className={`settings-nav-item ${activeSection === item.id ? 'active' : ''}`} onClick={() => { setSection(item.id); clearFeedback() }}>
          <div><b>{item.label}</b><small>{item.description}</small></div><ChevronRight size={14}/>
        </button>)}
        {isManager && <button className={`settings-nav-item ${activeSection === 'users' ? 'active' : ''}`} onClick={() => { setSection('users'); clearFeedback() }}>
          <div><b>Usuarios y permisos</b><small>Accesos</small></div><ChevronRight size={14}/>
        </button>}
      </div>
      <div className="settings-sidebar-footer"><span className="settings-user-dot"></span>{isManager ? 'Gerente' : 'Administrador'}</div>
    </aside>

    <main className="settings-content">
      <header className="settings-content-head"><div><span className="settings-overline">CONFIGURACIÓN</span><h2>{contentTitle}</h2></div><div className="settings-head-count">{activeSection === 'payments' ? `${paymentMethods.length} medios` : activeSection === 'categories' ? `${categories.length} categorías` : activeSection === 'users' ? 'Accesos' : 'Preferencias'}</div></header>

      {(error || message) && <div className={`settings-feedback ${error ? 'error' : 'success'}`}>{error || message}</div>}

      {activeSection === 'general' && <div className="settings-list-card">
        <div className="settings-list-row settings-list-row-click" onClick={() => setSection('payments')}><div className="settings-row-icon"><CreditCard size={16}/></div><div className="settings-row-copy"><b>Medios de pago</b><span>{paymentMethods.length} disponibles en el cobro</span></div><ChevronRight size={15}/></div>
        <div className="settings-list-row settings-list-row-click" onClick={() => setSection('categories')}><div className="settings-row-icon"><Tag size={16}/></div><div className="settings-row-copy"><b>Categorías</b><span>{categories.length} categorías · {products.length} productos</span></div><ChevronRight size={15}/></div>
        {isManager && <div className="settings-list-row settings-list-row-click" onClick={() => setSection('users')}><div className="settings-row-icon"><UsersIcon size={16}/></div><div className="settings-row-copy"><b>Usuarios y permisos</b><span>Control de acceso por usuario</span></div><ChevronRight size={15}/></div>}
      </div>}

      {activeSection === 'payments' && <div className="settings-list-card">
        <div className="settings-section-toolbar"><div><b>Medios disponibles</b><span>Agrega, edita o retira los que aparecen al cobrar.</span></div><div className="settings-counter-inline">{paymentMethods.length}</div></div>
        <div className="settings-rows">{paymentMethods.map(method => { const Icon = paymentIcon(method.id); return <div className="settings-list-row" key={method.id}>
          <div className="settings-row-icon"><Icon size={16}/></div>
          {editingPaymentId === method.id ? <input className="settings-row-edit" autoFocus value={editingPaymentName} onChange={event => setEditingPaymentName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void savePayment(method); if (event.key === 'Escape') { setEditingPaymentId(null); setEditingPaymentName('') } }}/> : <div className="settings-row-copy"><b>{method.name}</b><span>{method.id.startsWith('custom-') ? 'Personalizado' : 'Base'}</span></div>}
          <div className="settings-row-actions">{editingPaymentId === method.id ? <><button className="settings-action-btn" disabled={saving} onClick={() => void savePayment(method)} title="Guardar"><Check size={14}/></button><button className="settings-action-btn" disabled={saving} onClick={() => { setEditingPaymentId(null); setEditingPaymentName('') }} title="Cancelar">×</button></> : <><button className="settings-action-btn" disabled={saving} onClick={() => { setEditingPaymentId(method.id); setEditingPaymentName(method.name) }} title="Editar"><Pencil size={14}/></button><button className="settings-action-btn danger" disabled={saving} onClick={() => void removePayment(method)} title="Quitar"><Trash2 size={14}/></button></>}</div>
        </div> })}</div>
        <div className="settings-add-row"><input value={paymentName} onChange={event => setPaymentName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addPayment() }} placeholder="Nuevo medio de pago" maxLength={35}/><button className="primary" disabled={saving || !paymentName.trim()} onClick={() => void addPayment()}><Plus size={14}/> Agregar</button></div>
      </div>}

      {activeSection === 'categories' && <div className="settings-list-card">
        <div className="settings-section-toolbar"><div><b>Categorías del catálogo</b><span>Edita el nombre y se actualizan los productos que la usan.</span></div><div className="settings-counter-inline">{categories.length}</div></div>
        <div className="settings-rows">{categories.map(category => <div className="settings-list-row" key={category}>
          <div className="settings-row-icon"><Tag size={16}/></div>
          {editingCategory === category ? <input className="settings-row-edit" autoFocus value={editingCategoryName} onChange={event => setEditingCategoryName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void saveCategory(category); if (event.key === 'Escape') { setEditingCategory(null); setEditingCategoryName('') } }}/> : <div className="settings-row-copy"><b>{category}</b><span>{categoryCounts[category] || 0} productos</span></div>}
          <div className="settings-row-actions">{editingCategory === category ? <><button className="settings-action-btn" disabled={saving} onClick={() => void saveCategory(category)} title="Guardar"><Check size={14}/></button><button className="settings-action-btn" disabled={saving} onClick={() => { setEditingCategory(null); setEditingCategoryName('') }} title="Cancelar">×</button></> : <><button className="settings-action-btn" disabled={saving} onClick={() => startCategoryEdit(category)} title="Editar"><Pencil size={14}/></button><button className="settings-action-btn danger" disabled={saving || DEFAULT_PRODUCT_CATEGORIES.includes(category) || !!categoryCounts[category]} onClick={() => void removeCategory(category)} title={categoryCounts[category] ? 'Tiene productos asignados' : DEFAULT_PRODUCT_CATEGORIES.includes(category) ? 'Categoría base' : 'Eliminar'}><Trash2 size={14}/></button></>}</div>
        </div>)}</div>
        <div className="settings-add-row"><input value={categoryName} onChange={event => setCategoryName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addCategory() }} placeholder="Nueva categoría" maxLength={40}/><button className="primary" disabled={saving || !categoryName.trim()} onClick={() => void addCategory()}><Plus size={14}/> Agregar</button></div>
      </div>}

      {activeSection === 'users' && isManager && <div className="settings-users-pane"><Users embedded /></div>}
    </main>
  </div>
}
