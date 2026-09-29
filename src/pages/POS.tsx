import { ArrowLeft, Minus, Plus, Printer, ShoppingCart, Trash2, UtensilsCrossed } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createOrder, getProducts } from '../lib/store'
import { money } from '../lib/format'
import type { Product, SaleItem } from '../lib/types'
import { getSessionUser } from '../lib/auth'
import { printOrderComanda } from '../lib/print'

const emptyItem = (product: Product): SaleItem => ({ productId: product.id, name: product.name, quantity: 1, unitPrice: product.price, total: product.price })

export function POS() {
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [editing, setEditing] = useState(false)
  const [category, setCategory] = useState('Todos')
  const [cart, setCart] = useState<SaleItem[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (editing) void getProducts().then(setProducts) }, [editing])

  const categories = ['Todos', 'Hamburguesas', 'Combos', 'Acompañamientos', 'Bebidas']
  const filtered = products.filter(p => category === 'Todos' || p.category === category)
  const total = useMemo(() => cart.reduce((a, i) => a + i.total, 0), [cart])
  const units = cart.reduce((a, i) => a + i.quantity, 0)

  const add = (product: Product) => setCart(current => {
    const existing = current.find(item => item.productId === product.id)
    if (existing) return current.map(item => item.productId === product.id ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.unitPrice } : item)
    return [...current, emptyItem(product)]
  })

  const change = (id: string, delta: number) => setCart(current => current.flatMap(item => item.productId === id
    ? (item.quantity + delta <= 0 ? [] : [{ ...item, quantity: item.quantity + delta, total: (item.quantity + delta) * item.unitPrice }])
    : [item]
  ))

  const registerOrder = async () => {
    const user = getSessionUser()
    if (!cart.length || !user || saving) return
    const printTarget = window.open('', '_blank', 'width=420,height=720')
    setSaving(true)
    try {
      const order = await createOrder(cart, { customerName: '', phone: '', address: '', notes: '' }, user)
      printOrderComanda(order, printTarget)
      setCart([])
      navigate('/pedidos')
    } catch {
      printTarget?.close()
    } finally { setSaving(false) }
  }

  if (!editing) return <div className="pos-landing">
    <div className="pos-landing-card">
      <div className="pos-landing-icon"><UtensilsCrossed size={26}/></div>
      <p className="eyebrow">PUNTO DE VENTA</p>
      <h1>Registrar nuevo pedido</h1>
      <p>Empieza un pedido nuevo, agrega los productos y al guardarlo se generará la comanda para cocina.</p>
      <button className="primary landing-primary" onClick={() => setEditing(true)}><Plus size={18}/> Registrar nuevo pedido</button>
      <button className="landing-secondary" onClick={() => navigate('/pedidos')}>Ver pedidos de hoy</button>
    </div>
  </div>

  return <div className="pos-page pos-editor">
    <div className="page-heading compact">
      <div className="pos-editor-title"><button className="back-soft" onClick={() => { setCart([]); setEditing(false) }}><ArrowLeft size={16}/> Volver</button><div><p className="eyebrow">NUEVO PEDIDO</p><h1>Armar pedido</h1><p className="muted">Selecciona los productos y revisa el resumen antes de guardarlo.</p></div></div>
      <div className="sync-pill"><span className="dot online"/> Pedido en edición</div>
    </div>

    <div className="pos-layout">
      <section className="catalog">
        <div className="category-tabs">{categories.map(item => <button className={category === item ? 'selected' : ''} onClick={() => setCategory(item)} key={item}>{item}</button>)}</div>
        <div className="product-grid">
          {filtered.map(product => <button className="product-card" key={product.id} onClick={() => add(product)}>
            <div className="product-photo">{product.category === 'Hamburguesas' ? '🍔' : product.category === 'Combos' ? '🍔🍟' : product.category === 'Bebidas' ? '🥤' : '🍟'}</div>
            <div><b>{product.name}</b><span>{money(product.price)}</span></div>
            <Plus size={17}/>
          </button>)}
        </div>
      </section>

      <aside className="cart pos-summary-drawer">
        <div className="cart-header"><div><h2>Resumen del pedido</h2><p>{units} productos seleccionados</p></div><ShoppingCart size={20}/></div>
        <div className="cart-items">
          {cart.length === 0
            ? <div className="empty-cart"><ShoppingCart size={32}/><b>Tu pedido está vacío</b><span>Agrega productos desde la izquierda.</span></div>
            : cart.map(item => <div className="cart-item" key={item.productId}>
              <div><b>{item.name}</b><span>{money(item.unitPrice)} c/u</span>{item.modification && <small className="cart-modification">{item.modification}</small>}</div>
              <div className="qty"><button onClick={() => change(item.productId, -1)}><Minus size={13}/></button><b>{item.quantity}</b><button onClick={() => change(item.productId, 1)}><Plus size={13}/></button></div>
              <strong>{money(item.total)}</strong>
              <button className="trash" onClick={() => setCart(current => current.filter(x => x.productId !== item.productId))}><Trash2 size={15}/></button>
            </div>)}
        </div>
        <div className="checkout order-register">
          <div><span>Total del pedido</span><strong>{money(total)}</strong></div>
          <button disabled={!cart.length || saving} onClick={() => void registerOrder}><Printer size={17}/> {saving ? 'Guardando…' : 'Guardar pedido e imprimir comanda'}</button>
          {!cart.length && <small>Agrega al menos un producto para guardar el pedido.</small>}
        </div>
      </aside>
    </div>
  </div>
}
