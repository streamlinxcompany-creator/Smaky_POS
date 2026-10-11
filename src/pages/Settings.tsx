import { Banknote, Check, ChevronRight, CreditCard, Pencil, Plus, Settings2, Tag, Trash2, WalletCards, Users as UsersIcon, Package, ClipboardList, Palette, Sun, Moon, Monitor, GripVertical, X, FileText, Ruler } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getSessionUser, hasPermission } from '../lib/auth'
import { addPaymentMethod, addProductCategory, DEFAULT_GENERAL_SETTINGS, DEFAULT_ORDER_FIELDS, DEFAULT_PRODUCT_CATEGORIES, DEFAULT_INVENTORY_UNITS, deletePaymentMethod, deleteProductCategory, getAllProducts, getCustomInventoryUnits, getGeneralSettings, getInventoryUnits, getOrderFields, getPaymentMethods, getProductCategories, saveCustomInventoryUnits, updateGeneralSettings, updateOrderFields, updatePaymentMethod, updateProductCategory } from '../lib/store'
import type { GeneralSettings, OrderFieldConfig, OrderFieldType, PaymentMethodConfig, ThemeMode } from '../lib/types'
import type { LucideIcon } from 'lucide-react'
import { Users } from './Users'
import { Products } from './Products'
import { getInventorySnapshot } from '../lib/inventory'
import type { InventoryItem, InventoryRecipe } from '../lib/types'

type SettingsSection = 'general' | 'orders' | 'payments' | 'categories' | 'products' | 'inventory' | 'invoice' | 'users'
type PrintPreviewType = 'invoice' | 'comanda' | 'closure'
type UnitUsageDialog = { unit: string; items: InventoryItem[]; recipes: Array<{ productName: string; itemName: string }> }

const paymentIcon = (id: string) => id === 'cash' ? Banknote : id === 'transfer' ? WalletCards : CreditCard

const sectionMeta: Array<{ id: SettingsSection; label: string; description: string }> = [
  { id: 'general', label: 'General', description: 'Resumen' },
  { id: 'orders', label: 'Pedidos', description: 'Información' },
  { id: 'payments', label: 'Medios de pago', description: 'Cobros' },
  { id: 'categories', label: 'Categorías', description: 'Productos' },
  { id: 'products', label: 'Productos', description: 'Catálogo' },
  { id: 'inventory', label: 'Inventario', description: 'Unidades de medida' },
  { id: 'invoice', label: 'Factura', description: 'Comprobante' },
]

export function Settings() {
  const user = getSessionUser()
  const [section, setSection] = useState<SettingsSection>('general')
  const [categories, setCategories] = useState<string[]>([])
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>([])
  const [products, setProducts] = useState<Awaited<ReturnType<typeof getAllProducts>>>([])
  const [inventoryUnits, setInventoryUnits] = useState<string[]>(DEFAULT_INVENTORY_UNITS)
  const [customInventoryUnits, setCustomInventoryUnits] = useState<string[]>([])
  const [newInventoryUnit, setNewInventoryUnit] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [paymentName, setPaymentName] = useState('')
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null)
  const [editingPaymentName, setEditingPaymentName] = useState('')
  const [orderFields, setOrderFields] = useState<OrderFieldConfig[]>(DEFAULT_ORDER_FIELDS)
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings>(DEFAULT_GENERAL_SETTINGS)
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldType, setNewFieldType] = useState<OrderFieldType>('text')
  const [newFieldOptions, setNewFieldOptions] = useState('')
  const [editingOrderField, setEditingOrderField] = useState<OrderFieldConfig | null>(null)
  const [editingFieldLabel, setEditingFieldLabel] = useState('')
  const [editingFieldType, setEditingFieldType] = useState<OrderFieldType>('text')
  const [editingFieldRequired, setEditingFieldRequired] = useState(false)
  const [editingFieldOptions, setEditingFieldOptions] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [printPreviewType, setPrintPreviewType] = useState<PrintPreviewType>('invoice')
  const [unitUsageDialog, setUnitUsageDialog] = useState<UnitUsageDialog | null>(null)

  const canManage = !!user && ['manager', 'admin'].includes(user.role)
  const isManager = user?.role === 'manager'
  const canManageProducts = !!user && hasPermission(user, 'products.manage')
  const canManageInvoice = !!user && hasPermission(user, 'invoice.settings')
  const canManageGeneral = !!user && hasPermission(user, 'settings.general')
  const canManageOrders = !!user && hasPermission(user, 'settings.orders')
  const canManagePayments = !!user && hasPermission(user, 'settings.payments')
  const canManageCategories = !!user && hasPermission(user, 'settings.categories')
  const canManageInventory = !!user && ['manager', 'admin'].includes(user.role)

  const load = async () => {
    const [nextCategories, nextProducts, methods, fields, general, units, customUnits] = await Promise.all([getProductCategories(), getAllProducts(), getPaymentMethods(), getOrderFields(), getGeneralSettings(), getInventoryUnits(), getCustomInventoryUnits()])
    setCategories(nextCategories)
    setProducts(nextProducts)
    setPaymentMethods(methods)
    setOrderFields(fields)
    setGeneralSettings(general)
    setInventoryUnits(units)
    setCustomInventoryUnits(customUnits)
  }

  useEffect(() => {
    void load()
    const onSettingsChanged = () => { void load() }
    window.addEventListener('smaky-settings-change', onSettingsChanged)
    return () => window.removeEventListener('smaky-settings-change', onSettingsChanged)
  }, [])

  const clearFeedback = () => { setError(''); setMessage('') }
  const flashError = (caught: unknown) => setError(caught instanceof Error ? caught.message : 'No fue posible guardar el cambio.')

  const addCategory = async () => {
    if (!user || !(canManage || canManageCategories) || saving) return
    setSaving(true); clearFeedback()
    try {
      setCategories(await addProductCategory(categoryName, user))
      setCategoryName('')
      setMessage('Categoría agregada.')
    } catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const startCategoryEdit = (name: string) => { setEditingCategory(name); setEditingCategoryName(name); clearFeedback() }

  const saveCategory = async (oldName: string) => {
    if (!user || !(canManage || canManageCategories) || saving) return
    setSaving(true); clearFeedback()
    try {
      setCategories(await updateProductCategory(oldName, editingCategoryName, user))
      setEditingCategory(null)
      setEditingCategoryName('')
      await load()
      setMessage('Categoría actualizada.')
    } catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const addInventoryUnit = async () => {
    if (!user || !canManageInventory || saving) return
    const label = newInventoryUnit.trim().replace(/\s+/g, ' ')
    if (!label) return
    if (label.length > 32) { flashError(new Error('La unidad no puede superar 32 caracteres.')); return }
    if (inventoryUnits.some(unit => unit.toLocaleLowerCase('es') === label.toLocaleLowerCase('es'))) {
      flashError(new Error('Esa unidad ya existe.'))
      return
    }
    setSaving(true); clearFeedback()
    try {
      const nextCustom = await saveCustomInventoryUnits([...customInventoryUnits, label], user)
      setCustomInventoryUnits(nextCustom)
      setInventoryUnits(await getInventoryUnits())
      setNewInventoryUnit('')
      setMessage('Unidad agregada; se sincronizará con los demás dispositivos.')
    } catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const removeInventoryUnit = async (unit: string) => {
    if (!user || !canManageInventory || saving) return
    if (DEFAULT_INVENTORY_UNITS.some(base => base.toLocaleLowerCase('es') === unit.toLocaleLowerCase('es'))) return
    setSaving(true); clearFeedback(); setUnitUsageDialog(null)
    try {
      const snapshot = await getInventorySnapshot()
      const normalized = unit.toLocaleLowerCase('es')
      // Ignore archived/removed inventory records and recipe rows belonging to deleted products.
      // Old historical rows were the reason a previously-unused unit could remain undeletable.
      const activeItems = snapshot.items.filter(item => item.active && !item.removedAt)
      const itemReferences = activeItems.filter(item => item.unit.trim().toLocaleLowerCase('es') === normalized)
      const activeItemIds = new Set(activeItems.map(item => item.id))
      const activeProductIds = new Set(products.filter(product => product.active && !product.deletedAt).map(product => product.id))
      const recipeReferences = snapshot.recipes
        .filter(recipe => activeProductIds.has(recipe.productId) && activeItemIds.has(recipe.inventoryItemId))
        .filter(recipe => recipe.quantityUnit.trim().toLocaleLowerCase('es') === normalized || itemReferences.some(item => item.id === recipe.inventoryItemId))
        .map(recipe => ({ productName: recipe.productName, itemName: recipe.itemName }))
        .filter((reference, index, all) => all.findIndex(other => other.productName === reference.productName && other.itemName === reference.itemName) === index)

      if (itemReferences.length || recipeReferences.length) {
        setUnitUsageDialog({ unit, items: itemReferences, recipes: recipeReferences })
        return
      }
      const nextCustom = await saveCustomInventoryUnits(customInventoryUnits.filter(item => item.toLocaleLowerCase('es') !== normalized), user)
      setCustomInventoryUnits(nextCustom)
      setInventoryUnits(await getInventoryUnits())
      setMessage('Unidad eliminada de las opciones compartidas.')
    } catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const removeCategory = async (name: string) => {
    if (!user || !(canManage || canManageCategories) || saving) return
    if (!window.confirm(`¿Eliminar “${name}”?`)) return
    setSaving(true); clearFeedback()
    try { setCategories(await deleteProductCategory(name, user)); setMessage('Categoría eliminada.') }
    catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const addPayment = async () => {
    if (!user || !(canManage || canManagePayments) || saving) return
    setSaving(true); clearFeedback()
    try { setPaymentMethods(await addPaymentMethod(paymentName, user)); setPaymentName(''); setMessage('Medio de pago agregado.') }
    catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const savePayment = async (method: PaymentMethodConfig) => {
    if (!user || !(canManage || canManagePayments) || saving) return
    setSaving(true); clearFeedback()
    try { setPaymentMethods(await updatePaymentMethod(method.id, editingPaymentName, user)); setEditingPaymentId(null); setEditingPaymentName(''); setMessage('Medio de pago actualizado.') }
    catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const removePayment = async (method: PaymentMethodConfig) => {
    if (!user || !(canManage || canManagePayments) || saving) return
    if (!window.confirm(`¿Quitar “${method.name}”?`)) return
    setSaving(true); clearFeedback()
    try { setPaymentMethods(await deletePaymentMethod(method.id, user)); setMessage('Medio de pago retirado.') }
    catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const saveGeneral = async (changes: Partial<GeneralSettings>) => {
    const isPrintSetting = ['receiptFontSize', 'comandaFontSize', 'closureFontSize', 'receiptPaperWidth'].some(key => Object.hasOwn(changes, key))
    if (!user || !(isPrintSetting ? (canManage || canManageInvoice) : (canManage || canManageGeneral)) || saving) return
    setSaving(true); clearFeedback()
    try { setGeneralSettings(await updateGeneralSettings(changes, user)); setMessage('Preferencias generales actualizadas.') }
    catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const toggleOrderField = async (field: OrderFieldConfig, changes: Partial<OrderFieldConfig>) => {
    if (!user || !(canManage || canManageOrders) || saving) return
    setSaving(true); clearFeedback()
    try { setOrderFields(await updateOrderFields(orderFields.map(item => item.id === field.id ? { ...item, ...changes } : item), user)); setMessage('Campo de pedido actualizado.') }
    catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const openOrderFieldEditor = (field: OrderFieldConfig) => {
    setEditingOrderField(field)
    setEditingFieldLabel(field.label)
    setEditingFieldType(field.type)
    setEditingFieldRequired(field.required)
    setEditingFieldOptions((field.options || []).join(', '))
    clearFeedback()
  }

  const saveOrderFieldEditor = async () => {
    if (!user || !(canManage || canManageOrders) || !editingOrderField || saving) return
    const label = editingFieldLabel.trim()
    if (!label) { flashError(new Error('El nombre del campo no puede estar vacío.')); return }
    if (editingFieldType === 'select' && !editingFieldOptions.split(',').map(item => item.trim()).filter(Boolean).length) {
      flashError(new Error('Agrega al menos una opción para el selector.')); return
    }
    setSaving(true); clearFeedback()
    try {
      const options = editingFieldType === 'select' ? Array.from(new Set(editingFieldOptions.split(',').map(item => item.trim()).filter(Boolean))) : undefined
      const next = orderFields.map(item => item.id === editingOrderField.id ? { ...item, label, type: editingOrderField.system ? item.type : editingFieldType, required: editingFieldRequired, ...(options?.length ? { options } : { options: undefined }) } : item)
      setOrderFields(await updateOrderFields(next, user))
      setEditingOrderField(null)
      setMessage('Campo de pedido actualizado.')
    } catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const addOrderField = async () => {
    if (!user || !(canManage || canManageOrders) || saving || !newFieldLabel.trim()) return
    setSaving(true); clearFeedback()
    try {
      const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const options = newFieldType === 'select' ? Array.from(new Set(newFieldOptions.split(',').map(item => item.trim()).filter(Boolean))) : undefined
      if (newFieldType === 'select' && !options?.length) throw new Error('Agrega las opciones del selector separadas por comas.')
      const next: OrderFieldConfig[] = [...orderFields, { id, label: newFieldLabel.trim(), type: newFieldType, enabled: true, required: false, ...(options?.length ? { options } : {}), system: false }]
      setOrderFields(await updateOrderFields(next, user))
      setNewFieldLabel(''); setNewFieldType('text'); setNewFieldOptions(''); setMessage('Campo personalizado agregado.')
    } catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const removeOrderField = async (field: OrderFieldConfig) => {
    if (!user || !(canManage || canManageOrders) || saving || field.system) return
    if (!window.confirm(`¿Eliminar el campo “${field.label}” de los nuevos pedidos?`)) return
    setSaving(true); clearFeedback()
    try { setOrderFields(await updateOrderFields(orderFields.filter(item => item.id !== field.id), user)); setMessage('Campo eliminado.') }
    catch (caught) { flashError(caught) } finally { setSaving(false) }
  }

  const categoryCounts = useMemo(() => products.reduce<Record<string, number>>((acc, product) => {
    const key = product.category
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {}), [products])

  if (!user || (!canManage && !canManageInvoice && !canManageGeneral && !canManageOrders && !canManagePayments && !canManageCategories && !canManageProducts)) return null

  const allowedSections: SettingsSection[] = [
    ...(canManage || canManageGeneral ? ['general' as const] : []),
    ...(canManage || canManageOrders ? ['orders' as const] : []),
    ...(canManage || canManagePayments ? ['payments' as const] : []),
    ...(canManage || canManageCategories ? ['categories' as const] : []),
    ...(canManageProducts ? ['products' as const] : []),
    ...(canManageInventory ? ['inventory' as const] : []),
    ...(canManage || canManageInvoice ? ['invoice' as const] : []),
    ...(isManager ? ['users' as const] : []),
  ]
  const activeSection = allowedSections.includes(section) ? section : allowedSections[0]
  const contentTitle = activeSection === 'general' ? 'General' : activeSection === 'orders' ? 'Pedidos' : activeSection === 'payments' ? 'Medios de pago' : activeSection === 'categories' ? 'Categorías' : activeSection === 'products' ? 'Productos' : activeSection === 'inventory' ? 'Inventario' : activeSection === 'invoice' ? 'Factura' : 'Usuarios'

  return <div className="settings-page">
    <aside className="settings-sidebar">
      <div className="settings-brand-row"><div className="settings-brand-icon"><Settings2 size={16}/></div><div><h1>Configuraciones</h1><span>Smaky POS</span></div></div>
      <div className="settings-nav">
        {sectionMeta.filter(item => allowedSections.includes(item.id)).map(item => <button key={item.id} className={`settings-nav-item ${activeSection === item.id ? 'active' : ''}`} onClick={() => { setSection(item.id); clearFeedback() }}>
          <div><b>{item.label}</b><small>{item.description}</small></div><ChevronRight size={14}/>
        </button>)}
        {isManager && <button className={`settings-nav-item ${activeSection === 'users' ? 'active' : ''}`} onClick={() => { setSection('users'); clearFeedback() }}>
          <div><b>Usuarios y permisos</b><small>Accesos</small></div><ChevronRight size={14}/>
        </button>}
      </div>
      <div className="settings-sidebar-footer"><span className="settings-user-dot"></span>{isManager ? 'Gerente' : user.role === 'admin' ? 'Administrador' : 'Acceso a factura'}</div>
    </aside>

    <main className="settings-content">
      <header className="settings-content-head"><div><span className="settings-overline">CONFIGURACIÓN</span><h2>{contentTitle}</h2></div><div className="settings-head-count">{activeSection === 'orders' ? `${orderFields.filter(field => field.enabled).length} campos activos` : activeSection === 'payments' ? `${paymentMethods.length} medios` : activeSection === 'categories' ? `${categories.length} categorías` : activeSection === 'products' ? `${products.length} productos` : activeSection === 'inventory' ? `${customInventoryUnits.length} personalizadas` : activeSection === 'invoice' ? `${generalSettings.receiptFontSize}px` : activeSection === 'users' ? 'Accesos' : 'Preferencias'}</div></header>

      {(error || message) && <div className={`settings-feedback ${error ? 'error' : 'success'}`}>{error || message}</div>}

      {activeSection === 'general' && <div className="settings-stack">
        <section className="settings-list-card settings-feature-card">
          <div className="settings-feature-head"><div className="settings-row-icon settings-feature-icon"><Palette size={17}/></div><div><b>Apariencia</b><span>Define cómo quieres ver Smaky durante el día.</span></div></div>
          <div className="settings-theme-grid">
            {([['dark','Oscuro',Moon],['light','Claro',Sun],['auto','Automático',Monitor]] as Array<[ThemeMode,string,LucideIcon]>).map(([mode,label,Icon]) => <button key={mode} className={`settings-theme-option ${generalSettings.themeMode === mode ? 'active' : ''}`} disabled={saving} onClick={() => void saveGeneral({ themeMode: mode })}><Icon size={17}/><span>{label}</span>{generalSettings.themeMode === mode && <Check size={14}/>}</button>)}
          </div>
          {generalSettings.themeMode === 'auto' && <div className="settings-theme-auto-panel">
            <div className="settings-theme-auto-head"><Monitor size={16}/><div><b>Horario automático</b><small>Claro durante el día y oscuro por la noche. Por defecto, cambia a oscuro a las <b>19:00</b>.</small></div></div>
            <div className="settings-theme-times">
              <label><span>CLARO DESDE</span><input type="time" value={generalSettings.autoLightFrom} disabled={saving} onChange={event => void saveGeneral({ autoLightFrom: event.target.value })}/></label>
              <label><span>OSCURO DESDE</span><input type="time" value={generalSettings.autoDarkFrom} disabled={saving} onChange={event => void saveGeneral({ autoDarkFrom: event.target.value })}/></label>
            </div>
          </div>}
        </section>
        <section className="settings-list-card">
        <div className="settings-list-row settings-list-row-click" onClick={() => setSection('orders')}><div className="settings-row-icon"><ClipboardList size={16}/></div><div className="settings-row-copy"><b>Pedidos</b><span>{orderFields.filter(field => field.enabled).length} campos activos de información</span></div><ChevronRight size={15}/></div>
        <div className="settings-list-row settings-list-row-click" onClick={() => setSection('payments')}><div className="settings-row-icon"><CreditCard size={16}/></div><div className="settings-row-copy"><b>Medios de pago</b><span>{paymentMethods.length} disponibles en el cobro</span></div><ChevronRight size={15}/></div>
        <div className="settings-list-row settings-list-row-click" onClick={() => setSection('categories')}><div className="settings-row-icon"><Tag size={16}/></div><div className="settings-row-copy"><b>Categorías</b><span>{categories.length} categorías · {products.length} productos</span></div><ChevronRight size={15}/></div>
        {canManageProducts && <div className="settings-list-row settings-list-row-click" onClick={() => setSection('products')}><div className="settings-row-icon"><Package size={16}/></div><div className="settings-row-copy"><b>Productos</b><span>{products.length} en el catálogo</span></div><ChevronRight size={15}/></div>}
        {canManageInventory && <div className="settings-list-row settings-list-row-click" onClick={() => setSection('inventory')}><div className="settings-row-icon"><Ruler size={16}/></div><div className="settings-row-copy"><b>Inventario</b><span>{inventoryUnits.length} unidades disponibles</span></div><ChevronRight size={15}/></div>}
        {isManager && <div className="settings-list-row settings-list-row-click" onClick={() => setSection('users')}><div className="settings-row-icon"><UsersIcon size={16}/></div><div className="settings-row-copy"><b>Usuarios y permisos</b><span>Control de acceso por usuario</span></div><ChevronRight size={15}/></div>}
        <div className="settings-list-row settings-preference-row"><div className="settings-row-icon"><UsersIcon size={16}/></div><div className="settings-row-copy"><b>Consumidor final</b><span>Mostrarlo como opción rápida al iniciar un pedido.</span></div><label className="settings-toggle"><input type="checkbox" checked={generalSettings.showConsumerFinal} disabled={saving} onChange={event => void saveGeneral({ showConsumerFinal: event.target.checked })}/><span></span></label></div>
        </section>
      </div>}

      {activeSection === 'invoice' && (canManage || canManageInvoice) && <div className="settings-stack">
        <section className="settings-list-card settings-feature-card settings-print-settings-card">
          <div className="settings-feature-head"><div className="settings-row-icon settings-feature-icon"><FileText size={17}/></div><div><b>Impresión térmica</b><span>Ajusta cada comprobante y revisa una vista previa antes de probar en papel.</span></div></div>
          <div className="settings-print-document-tabs" role="tablist" aria-label="Tipo de documento">
            {([['invoice','Factura'],['comanda','Comanda'],['closure','Cierre de caja']] as Array<[PrintPreviewType,string]>).map(([type,label]) => <button key={type} type="button" role="tab" aria-selected={printPreviewType === type} className={printPreviewType === type ? 'active' : ''} onClick={() => setPrintPreviewType(type)}>{label}</button>)}
          </div>
          <div className="settings-print-layout">
          <div className="settings-print-controls">
            <label className="settings-field-editor-label"><span>Tamaño de letra</span><select value={printPreviewType === 'invoice' ? generalSettings.receiptFontSize : printPreviewType === 'comanda' ? generalSettings.comandaFontSize : generalSettings.closureFontSize} disabled={saving} onChange={event => { const size = Number(event.target.value); void saveGeneral(printPreviewType === 'invoice' ? { receiptFontSize: size } : printPreviewType === 'comanda' ? { comandaFontSize: size } : { closureFontSize: size }) }}>{Array.from({ length: 12 }, (_, index) => index + 7).map(size => <option key={size} value={size}>{size}px</option>)}</select></label>
            <label className="settings-field-editor-label"><span>Ancho del rollo</span><select value={generalSettings.receiptPaperWidth} disabled={saving} onChange={event => void saveGeneral({ receiptPaperWidth: Number(event.target.value) as 58 | 80 | 88 })}><option value={58}>58 mm</option><option value={80}>80 mm</option><option value={88}>88 mm</option></select><small>Debe coincidir con el papel seleccionado en el controlador de la impresora.</small></label>
          </div>
          <div className="settings-print-preview-shell">
            <div className="settings-print-preview-header"><b>Vista previa</b><span>{generalSettings.receiptPaperWidth} mm · {printPreviewType === 'invoice' ? generalSettings.receiptFontSize : printPreviewType === 'comanda' ? generalSettings.comandaFontSize : generalSettings.closureFontSize}px</span></div>
            <div className="settings-print-preview-stage">
              <div className={`settings-print-preview paper-${generalSettings.receiptPaperWidth}`} style={{ fontSize: `${printPreviewType === 'invoice' ? generalSettings.receiptFontSize : printPreviewType === 'comanda' ? generalSettings.comandaFontSize : generalSettings.closureFontSize}px` }}>
                <div className="preview-center"><b className="preview-brand">{printPreviewType === 'comanda' ? 'COMANDA DE COCINA' : 'Smaky Burgers'}</b><b className="preview-title">{printPreviewType === 'invoice' ? 'FACTURA · COPIA' : printPreviewType === 'comanda' ? 'PEDIDO #1042' : 'CIERRE DE CAJA'}</b>{printPreviewType !== 'closure' && <span>Pedido #1042</span>}</div>
                <hr/>
                {printPreviewType === 'invoice' ? <><div>Fecha: 10/10/2026 12:30</div><div>Atendido por: Gerente</div><section className="preview-customer"><b>DATOS DEL CLIENTE</b><div>Cliente: María Pérez</div><div>Teléfono: 300 000 0000</div><div>Dirección: Calle 10 # 5-20</div></section><hr/><div className="preview-line"><span>2× Hamburguesa clásica</span><b>$24.000</b></div><div className="preview-line"><span>1× Papas</span><b>$5.000</b></div><hr/><div className="preview-line"><span>Subtotal</span><b>$29.000</b></div><div className="preview-line preview-total"><span>TOTAL</span><b>$29.000</b></div></> : printPreviewType === 'comanda' ? <><div>10/10/2026 12:30</div><div>Preparar: 3 unidades</div><hr/><div className="preview-line"><span>2× Hamburguesa clásica</span><b>2</b></div><small>Indicación: sin cebolla</small><div className="preview-line"><span>1× Papas</span><b>1</b></div></> : <><div>Período: 2026-10-10</div><div>Responsable: Gerente</div><hr/><div className="preview-line"><span>Ventas registradas</span><b>12</b></div><div className="preview-line"><span>TOTAL VENTAS</span><b>$345.000</b></div><hr/><b>MEDIOS DE PAGO</b><div className="preview-line"><span>Efectivo</span><b>$220.000</b></div><div className="preview-line"><span>Transferencia</span><b>$125.000</b></div><hr/><div className="preview-line preview-total"><span>CUADRE EXACTO</span><b>$0</b></div></>}
                <hr/><div className="preview-center">Smaky POS</div>
              </div>
            </div>
            <p className="settings-print-help">Para aprovechar el ancho real, selecciona el rollo correcto en el diálogo de impresión, usa escala 100 %, márgenes mínimos o ninguno y desactiva encabezados y pies del navegador.</p>
          </div>
          </div>
        </section>
      </div>}

      {activeSection === 'inventory' && canManageInventory && <div className="settings-stack">
        <section className="settings-list-card settings-feature-card settings-inventory-units-card">
          <div className="settings-feature-head"><div className="settings-row-icon settings-feature-icon"><Ruler size={17}/></div><div><b>Unidades de medida</b><span>Personaliza cómo cuentas tus ingredientes. Las unidades se comparten entre todos los dispositivos.</span></div></div>
          <form className="settings-inventory-unit-add" onSubmit={event => { event.preventDefault(); void addInventoryUnit() }}>
            <label><span>Nueva unidad</span><input value={newInventoryUnit} onChange={event => setNewInventoryUnit(event.target.value)} placeholder="Ej. bandeja, cucharón, paquete" maxLength={32} disabled={saving}/></label>
            <button className="primary" type="submit" disabled={saving || !newInventoryUnit.trim()}><Plus size={15}/>{saving ? 'Guardando…' : 'Agregar unidad'}</button>
          </form>
          <div className="settings-inventory-unit-section-label"><b>Unidades disponibles</b><span>{inventoryUnits.length}</span></div>
          <div className="settings-inventory-unit-list">
            {inventoryUnits.map(unit => {
              const isBase = DEFAULT_INVENTORY_UNITS.some(base => base.toLocaleLowerCase('es') === unit.toLocaleLowerCase('es'))
              return <div className="settings-inventory-unit-row" key={unit}>
                <div className="settings-inventory-unit-mark"><Ruler size={15}/></div>
                <div className="settings-row-copy"><b>{unit}</b><span>{isBase ? 'Incluida en Smaky' : 'Personalizada'}</span></div>
                {isBase ? <span className="settings-inventory-unit-badge">Base</span> : <button className="settings-action-btn danger" type="button" disabled={saving} onClick={() => void removeInventoryUnit(unit)} title={`Eliminar unidad ${unit}`} aria-label={`Eliminar unidad ${unit}`}><Trash2 size={14}/></button>}
              </div>
            })}
          </div>
        </section>
      </div>}

      {activeSection === 'orders' && <div className="settings-list-card settings-orders-card">
        <div className="settings-section-toolbar"><div><b>Información del pedido</b><span>Estos campos aparecen al registrar un cliente. Puedes crear tus propias preguntas.</span></div><div className="settings-counter-inline">{orderFields.filter(field => field.enabled).length}/{orderFields.length}</div></div>
        <div className="settings-orders-intro"><ClipboardList size={18}/><div><b>Campos de información</b><span>Nombre y celular son la base del cliente. Los demás pueden ajustarse según cómo trabaja el negocio.</span></div></div>
        <div className="settings-order-fields">{orderFields.map(field => <div className={`settings-order-field ${!field.enabled ? 'disabled' : ''}`} key={field.id}>
          <div className="settings-order-drag"><GripVertical size={15}/></div><div className="settings-row-copy"><b>{field.label}</b><span>{field.system ? 'Campo del sistema' : 'Campo personalizado'} · {field.type === 'textarea' ? 'Texto largo' : field.type === 'number' ? 'Número' : field.type === 'phone' ? 'Teléfono' : field.type === 'address' ? 'Dirección' : field.type === 'select' ? `Selector · ${(field.options || []).length} opciones` : 'Texto corto'}</span></div>
          <div className="settings-order-controls"><button className="settings-action-btn" disabled={saving} onClick={() => openOrderFieldEditor(field)} title="Cambiar nombre"><Pencil size={14}/></button><label className="settings-mini-check"><input type="checkbox" checked={field.required} disabled={saving || !field.enabled || (field.system && ['name','phone'].includes(field.id))} onChange={event => void toggleOrderField(field, { required: event.target.checked })}/><span>Oblig.</span></label><label className="settings-toggle"><input type="checkbox" checked={field.enabled} disabled={saving || (field.system && ['name','phone'].includes(field.id))} onChange={event => void toggleOrderField(field, { enabled: event.target.checked })}/><span></span></label><button className="settings-action-btn danger" disabled={saving || field.system} onClick={() => void removeOrderField(field)} title={field.system ? 'Campo del sistema' : 'Eliminar'}><Trash2 size={14}/></button></div>
        </div>)}</div>
        <div className="settings-custom-field-add"><div><b>Agregar una pregunta</b><span>Ejemplo: “¿Piso o apartamento?”, “¿Con qué salsa?” o cualquier dato que quieras pedir.</span></div><div className="settings-custom-field-form"><input value={newFieldLabel} onChange={event => setNewFieldLabel(event.target.value)} placeholder="Nombre del nuevo campo" maxLength={50}/><select value={newFieldType} onChange={event => setNewFieldType(event.target.value as OrderFieldType)}><option value="text">Texto corto</option><option value="textarea">Texto largo</option><option value="number">Número</option><option value="phone">Teléfono</option><option value="address">Dirección</option><option value="select">Selector / lista</option></select><input value={newFieldOptions} onChange={event => setNewFieldOptions(event.target.value)} placeholder={newFieldType === 'select' ? 'Opciones: Casa, Apartamento, Oficina' : 'Opcional: opciones del selector'} disabled={newFieldType !== 'select'} maxLength={500}/><button className="primary" disabled={saving || !newFieldLabel.trim() || (newFieldType === 'select' && !newFieldOptions.trim())} onClick={() => void addOrderField()}><Plus size={14}/> Agregar campo</button></div></div>
      </div>}

      {editingOrderField && <div className="item-editor-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setEditingOrderField(null) }}>
        <section className="item-editor-modal settings-field-editor" role="dialog" aria-modal="true" aria-labelledby="settings-field-editor-title">
          <header className="item-editor-head">
            <div><span className="item-editor-kicker">CAMPO DE PEDIDO</span><h3 id="settings-field-editor-title">Editar información</h3><p>Configura cómo se solicitará este dato en los nuevos pedidos.</p></div>
            <button className="item-editor-close" onClick={() => setEditingOrderField(null)} aria-label="Cerrar"><X size={18}/></button>
          </header>
          <div className="item-editor-body settings-field-editor-body">
            <label className="settings-field-editor-label"><span>Nombre / etiqueta</span><input value={editingFieldLabel} onChange={event => setEditingFieldLabel(event.target.value)} maxLength={50}/></label>
            <label className="settings-field-editor-label"><span>Tipo de campo</span><select value={editingFieldType} disabled={editingOrderField.system} onChange={event => setEditingFieldType(event.target.value as OrderFieldType)}><option value="text">Texto corto</option><option value="textarea">Texto largo</option><option value="number">Número</option><option value="phone">Teléfono</option><option value="address">Dirección</option><option value="select">Selector / lista</option></select></label>
            {editingFieldType === 'select' && <label className="settings-field-editor-label"><span>Opciones</span><input value={editingFieldOptions} onChange={event => setEditingFieldOptions(event.target.value)} placeholder="Casa, Apartamento, Oficina"/><small>Sepáralas con comas.</small></label>}
            <label className="settings-field-editor-required"><input type="checkbox" checked={editingFieldRequired} disabled={editingOrderField.system && ['name','phone'].includes(editingOrderField.id)} onChange={event => setEditingFieldRequired(event.target.checked)}/><span>Solicitar este campo como obligatorio</span></label>
            {editingOrderField.system && <div className="settings-field-editor-note">Los campos base del sistema conservan su estructura para mantener compatibilidad con pedidos históricos.</div>}
          </div>
          <footer className="item-editor-footer"><button className="secondary" disabled={saving} onClick={() => setEditingOrderField(null)}>Cancelar</button><button className="primary" disabled={saving} onClick={() => void saveOrderFieldEditor()}>{saving ? 'Guardando…' : <><Check size={15}/> Guardar campo</>}</button></footer>
        </section>
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

      {activeSection === 'products' && canManageProducts && <div className="settings-products-pane"><Products embedded /></div>}

      {activeSection === 'users' && isManager && <div className="settings-users-pane"><Users embedded /></div>}
    </main>
    {unitUsageDialog && <div className="modal-backdrop settings-unit-usage-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setUnitUsageDialog(null) }}>
      <section className="modal settings-unit-usage-modal" role="dialog" aria-modal="true" aria-labelledby="unit-usage-title">
        <div className="modal-header"><div><p className="eyebrow">UNIDAD EN USO</p><h2 id="unit-usage-title">No se puede eliminar “{unitUsageDialog.unit}”</h2><p className="muted">Primero cambia o retira los elementos que todavía dependen de esta unidad.</p></div><button type="button" className="secondary" onClick={() => setUnitUsageDialog(null)} aria-label="Cerrar"><X size={17}/></button></div>
        {unitUsageDialog.items.length > 0 && <section className="settings-unit-usage-group"><h3>Ingredientes / existencias</h3><ul>{unitUsageDialog.items.map(item => <li key={item.id}><span><b>{item.name}</b><small>{item.recordKind === 'catalog_product' ? 'Producto del catálogo en inventario' : 'Ingrediente de inventario'} · unidad {item.unit}</small></span></li>)}</ul></section>}
        {unitUsageDialog.recipes.length > 0 && <section className="settings-unit-usage-group"><h3>Productos y recetas relacionados</h3><ul>{unitUsageDialog.recipes.map((recipe,index) => <li key={`${recipe.productName}-${recipe.itemName}-${index}`}><span><b>{recipe.productName}</b><small>Utiliza {recipe.itemName}</small></span></li>)}</ul></section>}
        <div className="settings-unit-usage-tip">Para liberar la unidad, ve a <b>Inventario → Existencias</b> y cambia o elimina el ingrediente relacionado; después revisa <b>Consumo por producto</b> para quitar o actualizar las recetas asociadas. Los registros históricos archivados no bloquean la eliminación.</div>
        <div className="modal-actions"><button type="button" className="primary" onClick={() => setUnitUsageDialog(null)}>Entendido</button></div>
      </section>
    </div>}
  </div>
}
