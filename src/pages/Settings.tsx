import { Banknote, Check, CircleHelp, CreditCard, LockKeyhole, Pencil, Plus, ReceiptText, Settings as SettingsIcon, ShieldCheck, Tag, Trash2, WalletCards } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getSessionUser } from '../lib/auth'
import { addPaymentMethod, addProductCategory, DEFAULT_PRODUCT_CATEGORIES, deletePaymentMethod, deleteProductCategory, getAllProducts, getPaymentMethods, getProductCategories, updatePaymentMethod } from '../lib/store'
import type { PaymentMethodConfig } from '../lib/types'
import { Users } from './Users'

const paymentIcon = (id: string) => id === 'cash' ? Banknote : id === 'transfer' ? WalletCards : CreditCard

export function Settings() {
  const user = getSessionUser()
  const [categories, setCategories] = useState<string[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>([])
  const [productCount, setProductCount] = useState(0)
  const [categoryName, setCategoryName] = useState('')
  const [paymentName, setPaymentName] = useState('')
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null)
  const [editingPaymentName, setEditingPaymentName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const canManage = !!user && ['manager', 'admin'].includes(user.role)
  const isManager = user?.role === 'manager'

  const load = async () => {
    const [nextCategories, products, methods] = await Promise.all([getProductCategories(), getAllProducts(), getPaymentMethods()])
    setCategories(nextCategories)
    setProductCount(products.length)
    setPaymentMethods(methods)
  }

  useEffect(() => { void load() }, [])

  const flashError = (caught: unknown) => setError(caught instanceof Error ? caught.message : 'No fue posible guardar el cambio.')
  const clearFeedback = () => { setError(''); setMessage('') }

  const addCategory = async () => {
    if (!user || !canManage || saving) return
    setSaving(true); clearFeedback()
    try {
      setCategories(await addProductCategory(categoryName, user)); setCategoryName(''); setMessage('Categoría agregada correctamente.')
    } catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const removeCategory = async (name: string) => {
    if (!user || !canManage || saving) return
    setSaving(true); clearFeedback()
    try { setCategories(await deleteProductCategory(name, user)); setMessage(`Categoría “${name}” eliminada.`) }
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
    if (!window.confirm(`¿Quitar “${method.name}” de los medios disponibles? Las ventas históricas se conservarán.`)) return
    setSaving(true); clearFeedback()
    try { setPaymentMethods(await deletePaymentMethod(method.id, user)); setMessage(`“${method.name}” ya no estará disponible para nuevos cobros.`) }
    catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const categoryPreview = useMemo(() => categories.slice(0, 9), [categories])

  if (!user || !canManage) return null

  return <div className="settings-shell">
    <div className="settings-hero">
      <div className="settings-hero-copy">
        <p className="eyebrow">CENTRO DE CONFIGURACIÓN</p>
        <h1>Configuraciones</h1>
        <p className="muted">Un solo centro para ajustar el catálogo, la forma de cobro y el acceso de cada cuenta. Diseñado para que una modificación aquí se refleje en todo Smaky.</p>
      </div>
      <div className="settings-hero-chip"><SettingsIcon size={14}/> {isManager ? 'Gerente · Control maestro' : 'Administrador · Configuración operativa'}</div>
    </div>

    {(error || message) && <div className={`settings-message ${error ? 'settings-error' : 'settings-success'}`}><CircleHelp size={14}/><span>{error || message}</span></div>}

    <div className="settings-command-grid">
      <article className="panel settings-command-card">
        <div className="settings-command-head"><div className="settings-command-icon"><CreditCard size={19}/></div><div className="settings-counter"><strong>{paymentMethods.length}</strong><span>medios</span></div></div>
        <div className="settings-command-copy"><span className="settings-kicker">COBROS · GENERAL</span><h2>Medios de pago</h2><p>Define qué opciones aparecen al cobrar. Puedes agregar, renombrar o retirar medios sin tocar el código del POS.</p></div>
        <div className="settings-payment-list">
          {paymentMethods.map(method => { const Icon = paymentIcon(method.id); return <div className="settings-payment-row" key={method.id}>
            <div className="settings-payment-mark"><Icon size={15}/></div>
            {editingPaymentId === method.id ? <input className="settings-edit-input" autoFocus value={editingPaymentName} onChange={event => setEditingPaymentName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void savePayment(method); if (event.key === 'Escape') setEditingPaymentId(null) }}/> : <div className="settings-payment-main"><b>{method.name}</b><span>{method.id.startsWith('custom-') ? 'Personalizado' : 'Medio base del sistema'}</span></div>}
            {editingPaymentId === method.id ? <div className="settings-payment-actions"><button className="settings-inline-btn" disabled={saving} onClick={() => void savePayment(method)}><Check size={13}/> Guardar</button><button className="settings-inline-btn" disabled={saving} onClick={() => setEditingPaymentId(null)}>Cancelar</button></div> : <div className="settings-payment-actions"><button className="settings-inline-btn" disabled={saving} onClick={() => { setEditingPaymentId(method.id); setEditingPaymentName(method.name) }} title="Renombrar"><Pencil size={13}/></button><button className="settings-inline-btn danger" disabled={saving} onClick={() => void removePayment(method)} title="Quitar"><Trash2 size={13}/></button></div>}
          </div> })}
        </div>
        <div className="settings-add-payment"><input value={paymentName} onChange={event => setPaymentName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addPayment() }} placeholder="Ej. Nequi, Daviplata, QR, Crédito…" maxLength={35}/><button className="primary" disabled={saving || !paymentName.trim()} onClick={() => void addPayment()}><Plus size={14}/> Agregar medio</button></div>
        <div className="settings-payments-note"><CircleHelp size={13}/><span>Los medios retirados dejan de aparecer para nuevos cobros, pero las facturas antiguas mantienen su información original.</span></div>
      </article>

      <article className="panel settings-command-card">
        <div className="settings-command-head"><div className="settings-command-icon"><Tag size={19}/></div><div className="settings-counter"><strong>{categories.length}</strong><span>categorías</span></div></div>
        <div className="settings-command-copy"><span className="settings-kicker">CATÁLOGO · PRODUCTOS</span><h2>Categorías</h2><p>El catálogo se alimenta desde aquí. Lo que agregues aparecerá en Productos y en el filtro del punto de venta.</p></div>
        <div className="settings-catalog-inner">
          <div className="settings-category-mini"><label><span>NUEVA CATEGORÍA</span><input value={categoryName} onChange={event => setCategoryName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addCategory() }} placeholder="Ej. Desayunos" maxLength={40}/></label><button className="primary" disabled={saving || !categoryName.trim()} onClick={() => void addCategory()}><Plus size={14}/> Agregar</button></div>
          <div className="settings-category-pills">{categoryPreview.map(item => <span className="settings-category-pill" key={item}><Tag size={11}/>{item}{!DEFAULT_PRODUCT_CATEGORIES.includes(item) && <button title={`Quitar ${item}`} disabled={saving} onClick={() => void removeCategory(item)}>×</button>}</span>)}</div>
          {categories.length > categoryPreview.length && <span className="settings-module-note">+ {categories.length - categoryPreview.length} categorías más disponibles en Productos.</span>}
          <div className="settings-module-note"><ReceiptText size={13}/><span>{productCount} productos registrados actualmente.</span></div>
        </div>
      </article>

      {isManager && <article className="panel settings-command-card settings-manager-card">
        <div className="settings-command-head"><div className="settings-command-icon"><ShieldCheck size={19}/></div><div className="settings-counter"><LockKeyhole size={17}/><span>gerente</span></div></div>
        <div className="settings-command-copy"><span className="settings-kicker">CONTROL DE ACCESO · SOLO GERENTE</span><h2>Usuarios y permisos</h2><p>Crea cuentas y decide función por función qué puede utilizar cada trabajador o administrador. El Punto de venta siempre queda habilitado.</p></div>
        <div className="settings-manager-lock"><ShieldCheck size={16}/><div><b>Panel protegido del Gerente</b><span>Los cambios de permisos quedan guardados en el perfil del usuario y se aplican al menú y a las rutas del sistema.</span></div></div>
        <div className="settings-users-container"><Users embedded /></div>
      </article>}
    </div>
  </div>
}
