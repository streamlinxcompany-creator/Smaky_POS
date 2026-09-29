import { Check, MapPin, Minus, Plus, Printer, ShoppingCart, Trash2, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createOrder, getProducts } from '../lib/store'
import { money } from '../lib/format'
import type { DeliveryInfo, Product, SaleItem } from '../lib/types'
import { getSessionUser } from '../lib/auth'
import { printOrderComanda } from '../lib/print'

const emptyDelivery: DeliveryInfo = { customerName: '', phone: '', address: '', notes: '' }

export function POS() {
  const [products, setProducts] = useState<Product[]>([])
  const user = getSessionUser()
  const [category, setCategory] = useState('Todos')
  const [cart, setCart] = useState<SaleItem[]>([])
  const [delivery, setDelivery] = useState<DeliveryInfo>(emptyDelivery)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => { getProducts().then(setProducts) }, [])

  const categories = ['Todos', 'Hamburguesas', 'Combos', 'Acompañamientos', 'Bebidas']
  const filtered = products.filter(p => category === 'Todos' || p.category === category)
  const total = useMemo(() => cart.reduce((a, i) => a + i.total, 0), [cart])
  const canRegister = Boolean(cart.length && delivery.customerName.trim() && delivery.address.trim())

  const add = (product: Product) => setCart(current => {
    const existing = current.find(item => item.productId === product.id)
    if (existing) return current.map(item => item.productId === product.id ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.unitPrice } : item)
    return [...current, { productId: product.id, name: product.name, quantity: 1, unitPrice: product.price, total: product.price }]
  })

  const change = (id: string, delta: number) => setCart(current => current.flatMap(item => item.productId === id
    ? (item.quantity + delta <= 0 ? [] : [{ ...item, quantity: item.quantity + delta, total: (item.quantity + delta) * item.unitPrice }])
    : [item]
  ))

  const setField = (key: keyof DeliveryInfo, value: string) => setDelivery(current => ({ ...current, [key]: value }))

  const registerOrder = async () => {
    if (!canRegister || !user || saving) return
    const printTarget = window.open('', '_blank', 'width=420,height=720')
    setSaving(true)
    try {
      const order = await createOrder(cart, delivery, user)
      printOrderComanda(order, printTarget)
      setCart([])
      setDelivery(emptyDelivery)
      setDone(true)
      setTimeout(() => setDone(false), 2600)
    } catch {
      printTarget?.close()
    } finally {
      setSaving(false)
    }
  }

  return <div className="pos-page">
    <div className="page-heading compact">
      <div><p className="eyebrow">DOMICILIOS</p><h1>Tomar pedido</h1><p className="muted">Registra el pedido, imprime la comanda y luego gestiónalo desde Pedidos.</p></div>
      <div className="sync-pill"><span className="dot online"/> Listo para recibir pedidos</div>
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

      <aside className="cart">
        <div className="cart-header"><div><h2>Pedido nuevo</h2><p>{cart.reduce((a, i) => a + i.quantity, 0)} productos · Domicilio</p></div><ShoppingCart size={20}/></div>

        <div className="delivery-form">
          <div className="delivery-form-title"><UserRound size={15}/><b>Datos del cliente</b></div>
          <input value={delivery.customerName} onChange={e => setField('customerName', e.target.value)} placeholder="Nombre del cliente *" />
          <input value={delivery.phone} onChange={e => setField('phone', e.target.value)} placeholder="Teléfono" inputMode="tel" />
          <div className="delivery-address"><MapPin size={15}/><input value={delivery.address} onChange={e => setField('address', e.target.value)} placeholder="Dirección de entrega *" /></div>
          <textarea value={delivery.notes} onChange={e => setField('notes', e.target.value)} placeholder="Observaciones (sin cebolla, apartamento, etc.)" rows={2}/>
        </div>

        <div className="cart-items">
          {cart.length === 0
            ? <div className="empty-cart"><ShoppingCart size={32}/><b>El pedido está vacío</b><span>Toca un producto para agregarlo</span></div>
            : cart.map(item => <div className="cart-item" key={item.productId}>
              <div><b>{item.name}</b><span>{money(item.unitPrice)} c/u</span></div>
              <div className="qty"><button onClick={() => change(item.productId, -1)}><Minus size={13}/></button><b>{item.quantity}</b><button onClick={() => change(item.productId, 1)}><Plus size={13}/></button></div>
              <strong>{money(item.total)}</strong>
              <button className="trash" onClick={() => setCart(current => current.filter(x => x.productId !== item.productId))}><Trash2 size={15}/></button>
            </div>)}
        </div>

        <div className="checkout order-register">
          <div><span>Total del pedido</span><strong>{money(total)}</strong></div>
          <button disabled={!canRegister || saving} onClick={() => void registerOrder}><Printer size={17}/> {saving ? 'Registrando…' : 'Registrar e imprimir comanda'}</button>
          {!canRegister && <small>Completa cliente, dirección y agrega productos para registrar.</small>}
        </div>
        {done && <div className="success-toast"><Check size={17}/> Pedido registrado · comanda enviada a impresión</div>}
      </aside>
    </div>
  </div>
}
