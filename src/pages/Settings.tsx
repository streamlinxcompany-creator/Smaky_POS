import { Check, CircleHelp, Plus, Settings as SettingsIcon, Tag, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getSessionUser } from '../lib/auth'
import { DEFAULT_PRODUCT_CATEGORIES, addProductCategory, deleteProductCategory, getAllProducts, getProductCategories } from '../lib/store'

export function Settings() {
  const user = getSessionUser()
  const [categories, setCategories] = useState<string[]>([])
  const [productCount, setProductCount] = useState(0)
  const [categoryName, setCategoryName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    const [nextCategories, products] = await Promise.all([getProductCategories(), getAllProducts()])
    setCategories(nextCategories)
    setProductCount(products.length)
  }

  useEffect(() => { void load() }, [])

  const addCategory = async () => {
    if (!user || !['manager', 'admin'].includes(user.role) || saving) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const next = await addProductCategory(categoryName, user)
      setCategories(next)
      setCategoryName('')
      setMessage('Categoría agregada correctamente.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible agregar la categoría.')
    } finally {
      setSaving(false)
    }
  }

  const removeCategory = async (name: string) => {
    if (!user || !['manager', 'admin'].includes(user.role) || saving) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const next = await deleteProductCategory(name, user)
      setCategories(next)
      setMessage(`Categoría “${name}” eliminada.`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible eliminar la categoría.')
    } finally {
      setSaving(false)
    }
  }

  if (!user || !['manager', 'admin'].includes(user.role)) return null

  return <div className="settings-page">
    <div className="page-heading compact settings-heading">
      <div>
        <p className="eyebrow">ADMINISTRACIÓN</p>
        <h1>Configuraciones</h1>
        <p className="muted">Un solo lugar para controlar los ajustes generales de Smaky. Este apartado crecerá con el sistema.</p>
      </div>
      <div className="settings-role-pill"><SettingsIcon size={15}/> {user.role === 'manager' ? 'Gerente' : 'Administrador'}</div>
    </div>

    <section className="settings-grid">
      <article className="panel settings-card settings-card-active">
        <div className="settings-card-head"><div className="settings-card-icon"><Tag size={18}/></div><div><span className="settings-kicker">CATÁLOGO</span><h2>Categorías de productos</h2><p>Las categorías que agregues aquí aparecerán automáticamente al crear productos y en el punto de venta.</p></div><span className="settings-active-badge"><Check size={12}/> Activo</span></div>
        <div className="settings-category-summary"><strong>{categories.length}</strong><span>categorías disponibles</span><small>{productCount} productos registrados</small></div>
        <div className="settings-add-row">
          <label><span>NUEVA CATEGORÍA</span><input value={categoryName} onChange={event => setCategoryName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addCategory() }} placeholder="Ej. Promociones" maxLength={40}/></label>
          <button className="primary settings-add-btn" disabled={saving || !categoryName.trim()} onClick={() => void addCategory()}><Plus size={16}/> Agregar</button>
        </div>
        {error && <div className="settings-message settings-error"><CircleHelp size={15}/>{error}</div>}
        {message && <div className="settings-message settings-success"><Check size={15}/>{message}</div>}
        <div className="settings-category-list">
          {categories.map((item, index) => {
            const base = DEFAULT_PRODUCT_CATEGORIES.includes(item)
            return <div className="settings-category-row" key={item}><div className="settings-category-dot"><Tag size={13}/></div><div><b>{item}</b><span>{base ? 'Categoría base del sistema' : 'Categoría personalizada'}</span></div>{!base && <button className="icon-action settings-delete" disabled={saving} onClick={() => void removeCategory(item)} title={`Eliminar ${item}`} aria-label={`Eliminar ${item}`}><Trash2 size={15}/></button>}</div>
          })}
        </div>
        <div className="settings-note"><CircleHelp size={14}/><span>No puedes eliminar las categorías base ni una categoría que ya esté asignada a un producto. Esto evita romper el catálogo existente.</span></div>
      </article>

      <article className="panel settings-card settings-card-muted">
        <div className="settings-card-head"><div className="settings-card-icon"><SettingsIcon size={18}/></div><div><span className="settings-kicker">PUNTO DE VENTA</span><h2>Configuración del POS</h2><p>Este módulo queda preparado para centralizar ajustes de operación, cobro y experiencia de caja.</p></div><span className="settings-soon">Próximamente</span></div>
        <div className="settings-placeholder-list"><div><b>Medios de pago</b><span>Efectivo · Transferencia · Tarjeta</span></div><div><b>Descuentos</b><span>Reglas y límites de descuento</span></div><div><b>Comportamiento después del cobro</b><span>Factura automática y retorno a pedidos</span></div></div>
      </article>

      <article className="panel settings-card settings-card-muted">
        <div className="settings-card-head"><div className="settings-card-icon"><Tag size={18}/></div><div><span className="settings-kicker">FACTURACIÓN</span><h2>Impresión térmica</h2><p>La factura ya queda preparada para papel térmico de 88 mm, alto automático y texto de alto contraste.</p></div><span className="settings-soon">En el sistema</span></div>
        <div className="settings-spec-grid"><div><span>ANCHO</span><b>88 mm</b></div><div><span>COLOR</span><b>Blanco y negro</b></div><div><span>MARGEN</span><b>Reducido</b></div><div><span>ALTO</span><b>Automático</b></div></div>
      </article>

      <article className="panel settings-card settings-card-muted">
        <div className="settings-card-head"><div className="settings-card-icon"><SettingsIcon size={18}/></div><div><span className="settings-kicker">SISTEMA</span><h2>Más configuraciones</h2><p>Seguridad, usuarios, cierres, respaldos, apariencia y comportamiento general se incorporarán aquí sin dispersar opciones por todo el POS.</p></div><span className="settings-soon">Próximamente</span></div>
        <div className="settings-future-grid"><span>Seguridad y permisos</span><span>Respaldos</span><span>Apariencia</span><span>Datos del negocio</span></div>
      </article>
    </section>
  </div>
}
