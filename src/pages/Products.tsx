import { Archive, ArchiveRestore, Pencil, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { getAllProducts, getProductCategories, saveProduct } from '../lib/store'
import { money } from '../lib/format'
import type { Product } from '../lib/types'

type FormState = {
  name: string
  category: string
  price: string
  active: boolean
}

const emptyForm: FormState = {
  name: '',
  category: 'Hamburguesas',
  price: '',
  active: true,
}

export function Products({ embedded = false }: { embedded?: boolean }) {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'Todos' | Product['category']>('Todos')
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const load = async () => {
    const [productsData, categoryData] = await Promise.all([getAllProducts(), getProductCategories()])
    setProducts(productsData)
    setCategories(categoryData)
  }

  useEffect(() => {
    void load()
    const refreshCatalogSettings = () => { void load() }
    window.addEventListener('smaky-settings-change', refreshCatalogSettings)
    return () => window.removeEventListener('smaky-settings-change', refreshCatalogSettings)
  }, [])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return products.filter(product => {
      const matchesQuery = !normalized || product.name.toLowerCase().includes(normalized)
      const matchesCategory = category === 'Todos' || product.category === category
      return matchesQuery && matchesCategory
    })
  }, [products, query, category])

  const openNew = () => {
    setEditing(null)
    setModalOpen(true)
    setForm({ ...emptyForm, category: categories[0] || '' })
    setError('')
  }

  const openEdit = (product: Product) => {
    setEditing(product)
    setModalOpen(true)
    setForm({
      name: product.name,
      category: product.category,
      price: String(product.price),
      active: product.active,
    })
    setError('')
  }

  const closeModal = () => {
    if (saving) return
    setEditing(null)
    setModalOpen(false)
    setError('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const name = form.name.trim()
    const price = Number(form.price)

    if (!name) {
      setError('Escribe el nombre del producto.')
      return
    }
    if (!Number.isFinite(price) || price <= 0) {
      setError('Ingresa un precio válido mayor que $0.')
      return
    }
    if (!form.category) {
      setError('Selecciona una categoría.')
      return
    }

    setSaving(true)
    try {
      const product: Product = {
        id: editing?.id ?? crypto.randomUUID(),
        name,
        category: form.category,
        price: Math.round(price),
        active: form.active,
      }
      await saveProduct(product)
      await load()
      setEditing(null)
      setModalOpen(false)
      setError('')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (product: Product) => {
    await saveProduct({ ...product, active: !product.active })
    await load()
  }

  return <div className={embedded ? 'products-page embedded' : 'products-page'}>
    {!embedded && <div className="page-heading compact">
      <div>
        <p className="eyebrow">CATÁLOGO</p>
        <h1>Productos</h1>
        <p className="muted">Aquí administras lo que aparece en el punto de venta.</p>
      </div>
      <button className="primary product-new-btn" onClick={openNew}><Plus size={17}/> Nuevo producto</button>
    </div>}

    {embedded && <div className="settings-products-head">
      <div>
        <b>Catálogo de productos</b>
        <span>Gestiona nombres, categorías, precios y disponibilidad.</span>
      </div>
      <button className="primary product-new-btn" onClick={openNew}><Plus size={16}/> Nuevo producto</button>
    </div>}

    <div className="panel products-toolbar">
      <div className="search-box"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar producto..." /></div>
      <div className="product-filters"><span className="settings-inline-hint">Administra categorías en Configuraciones</span>
        <button className={category === 'Todos' ? 'selected' : ''} onClick={() => setCategory('Todos')}>Todos</button>
        {categories.map(item => <button key={item} className={category === item ? 'selected' : ''} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
    </div>

    <div className="panel table-panel products-table-panel">
      {filtered.length === 0 ? <div className="products-empty"><Archive size={28}/><b>No hay productos para mostrar</b><span>Crea un producto y aparecerá aquí y en la caja si queda activo.</span></div> : <table>
        <thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Estado</th><th></th></tr></thead>
        <tbody>{filtered.map(product => <tr key={product.id}>
          <td><b>{product.name}</b></td>
          <td>{product.category}</td>
          <td><b>{money(product.price)}</b></td>
          <td><span className={product.active ? 'badge' : 'badge inactive'}>{product.active ? 'Activo' : 'Inactivo'}</span></td>
          <td><div className="table-actions"><button className="icon-action" title="Editar" onClick={() => openEdit(product)}><Pencil size={15}/></button><button className="icon-action" title={product.active ? 'Desactivar' : 'Activar'} onClick={() => toggleActive(product)}>{product.active ? <Archive size={15}/> : <ArchiveRestore size={15}/>}</button></div></td>
        </tr>)}</tbody>
      </table>}
    </div>

    {modalOpen && <div className="modal-backdrop" aria-hidden={false}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
        <div className="modal-header"><div><p className="eyebrow">CATÁLOGO</p><h2 id="product-modal-title">{editing ? 'Editar producto' : 'Nuevo producto'}</h2></div><button className="icon-btn" onClick={closeModal}><X size={18}/></button></div>
        <form onSubmit={submit}>
          <label>Nombre<input autoFocus value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Ej. Smaky Burger" /></label>
          <div className="form-row"><label>Categoría<select value={form.category} onChange={event => setForm(current => ({ ...current, category: event.target.value }))}>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label>Precio<input type="number" min="0" step="100" value={form.price} onChange={event => setForm(current => ({ ...current, price: event.target.value }))} placeholder="18900" /></label></div>
          <label className="check-row"><input type="checkbox" checked={form.active} onChange={event => setForm(current => ({ ...current, active: event.target.checked }))}/><span>Disponible en el punto de venta</span></label>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions"><button type="button" className="secondary" onClick={closeModal}>Cancelar</button><button type="submit" className="primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar producto'}</button></div>
        </form>
      </div>
    </div>}
  </div>
}
