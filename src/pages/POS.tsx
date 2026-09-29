import { Check, ChevronRight, CreditCard, Minus, Plus, ShoppingCart, Trash2, Wallet, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { getProducts, addSale } from '../lib/store'
import { money } from '../lib/format'
import type { PaymentMethod, Product, SaleItem } from '../lib/types'
import { getSessionUser } from '../lib/auth'

const paymentLabel = (payment: PaymentMethod) => payment === 'cash' ? 'Efectivo' : payment === 'transfer' ? 'Transferencia' : 'Tarjeta'

export function POS() {
  const [products, setProducts] = useState<Product[]>([])
  const user = getSessionUser()
  const [category, setCategory] = useState('Todos')
  const [cart, setCart] = useState<SaleItem[]>([])
  const [payment, setPayment] = useState<PaymentMethod>('cash')
  const [confirming, setConfirming] = useState(false)
  const [slideProgress, setSlideProgress] = useState(0)
  const [pending, setPending] = useState<{ items: SaleItem[]; payment: PaymentMethod; total: number } | null>(null)
  const [done, setDone] = useState(false)
  const [saving, setSaving] = useState(false)
  const slideProgressRef = useRef(0)

  useEffect(() => { getProducts().then(setProducts) }, [])

  const categories = ['Todos', 'Hamburguesas', 'Combos', 'Acompañamientos', 'Bebidas']
  const filtered = products.filter(p => category === 'Todos' || p.category === category)
  const total = useMemo(() => cart.reduce((a, i) => a + i.total, 0), [cart])

  const add = (product: Product) => setCart(current => {
    const existing = current.find(item => item.productId === product.id)
    if (existing) return current.map(item => item.productId === product.id ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * item.unitPrice } : item)
    return [...current, { productId: product.id, name: product.name, quantity: 1, unitPrice: product.price, total: product.price }]
  })

  const change = (id: string, delta: number) => setCart(current => current.flatMap(item => item.productId === id
    ? (item.quantity + delta <= 0 ? [] : [{ ...item, quantity: item.quantity + delta, total: (item.quantity + delta) * item.unitPrice }])
    : [item]
  ))

  const beginCheckout = () => {
    if (!cart.length) return
    setPending({ items: cart.map(item => ({ ...item })), payment, total })
    slideProgressRef.current = 0
    setSlideProgress(0)
    setConfirming(true)
  }

  const cancelCheckout = () => {
    setConfirming(false)
    slideProgressRef.current = 0
    setSlideProgress(0)
    setPending(null)
  }

  const confirmCheckout = async () => {
    if (!pending || slideProgressRef.current < 92 || saving) return
    setSaving(true)
    try {
      if (!user) return
      await addSale({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      userId: user.id,
      userName: user.name,
      payment: pending.payment,
      items: pending.items,
      subtotal: pending.total,
      total: pending.total
    })
      setCart([])
      setConfirming(false)
      setPending(null)
      slideProgressRef.current = 0
      setSlideProgress(0)
      setDone(true)
      setTimeout(() => setDone(false), 2400)
    } finally {
      setSaving(false)
    }
  }

  const updateSlide = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    const raw = ((event.clientX - bounds.left) / bounds.width) * 100
    const next = Math.max(0, Math.min(100, raw))
    slideProgressRef.current = next
    setSlideProgress(next)
  }

  const slidePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (saving) return
    event.currentTarget.setPointerCapture(event.pointerId)
    updateSlide(event)
  }

  const slidePointerUp = () => {
    if (slideProgressRef.current >= 92 && !saving) void confirmCheckout()
  }

  return <div className="pos-page">
    <div className="page-heading compact">
      <div><p className="eyebrow">CAJA</p><h1>Punto de venta</h1></div>
      <div className="sync-pill"><span className="dot online"/> Listo para vender</div>
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
        <div className="cart-header"><div><h2>Pedido actual</h2><p>{cart.reduce((a, i) => a + i.quantity, 0)} productos</p></div><ShoppingCart size={20}/></div>
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

        <div className="payment"><span>Método de pago</span><div className="payment-grid">
          {([['cash', 'Efectivo', Wallet], ['transfer', 'Transferencia', CreditCard], ['card', 'Tarjeta', CreditCard]] as const).map(([value, label, Icon]) => <button className={payment === value ? 'selected' : ''} onClick={() => setPayment(value)} key={value}><Icon size={16}/>{label}</button>)}
        </div></div>

        <div className="checkout">
          <div><span>Total</span><strong>{money(total)}</strong></div>
          <button disabled={!cart.length} onClick={beginCheckout}><Check size={18}/> Cobrar pedido</button>
        </div>
        {done && <div className="success-toast"><Check size={17}/> Venta guardada correctamente</div>}
      </aside>
    </div>

    {confirming && pending && <div className="modal-backdrop checkout-backdrop">
      <div className="checkout-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-order-title">
        <button className="checkout-modal-close" onClick={cancelCheckout} aria-label="Cancelar"><X size={18}/></button>
        <div className="confirm-icon"><ShoppingCart size={19}/></div>
        <p className="eyebrow">CONFIRMACIÓN</p>
        <h2 id="confirm-order-title">¿Seguro del pedido?</h2>
        <p className="confirm-copy">Revisa los productos y el método de pago antes de registrar la venta.</p>

        <div className="confirm-order-list">{pending.items.map(item => <div className="confirm-order-item" key={item.productId}>
          <div><b>{item.quantity}× {item.name}</b><span>{money(item.unitPrice)} c/u</span></div>
          <strong>{money(item.total)}</strong>
        </div>)}</div>

        <div className="confirm-summary">
          <div><span>Método de pago</span><b>{paymentLabel(pending.payment)}</b></div>
          <div><span>Total</span><strong>{money(pending.total)}</strong></div>
        </div>

        <div className="confirm-slider-wrap">
          <div className="slider-hint"><span>Mueve para confirmar</span><div className="slider-lights" aria-hidden="true"><i/><i/><i/><ChevronRight size={14}/></div></div>
          <div className={`confirm-slider ${slideProgress >= 92 ? 'ready' : ''}`} onPointerDown={slidePointerDown} onPointerMove={event => event.currentTarget.hasPointerCapture(event.pointerId) && updateSlide(event)} onPointerUp={slidePointerUp} onPointerCancel={slidePointerUp}>
            <div className="confirm-slider-fill" style={{ width: `${slideProgress}%` }}/>
            <div className="confirm-slider-text">{slideProgress >= 92 ? 'Suelta para confirmar' : 'Desliza hacia la derecha'}</div>
            <div className="confirm-slider-thumb" style={{ left: `calc(${8 + (Math.min(100, Math.max(0, slideProgress)) * 0.84)}% - 24px)` }}><ChevronRight size={19}/></div>
          </div>
          <p className="slider-safe-note">La venta solo se guarda cuando completas el deslizamiento.</p>
          {saving && <div className="confirm-saving"><span className="spinner"/> Guardando venta...</div>}
        </div>
      </div>
    </div>}
  </div>
}
