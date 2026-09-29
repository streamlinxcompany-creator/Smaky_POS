import { Plus, UtensilsCrossed } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OrderWorkspace } from '../components/OrderWorkspace'
import { getSessionUser } from '../lib/auth'

export function POS() {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const user = getSessionUser()

  if (!user) return null

  if (!editing) return <div className="pos-landing">
    <div className="pos-landing-card">
      <div className="pos-landing-icon"><UtensilsCrossed size={26}/></div>
      <p className="eyebrow">PUNTO DE VENTA</p>
      <h1>Registrar nuevo pedido</h1>
      <p>Un solo panel para agregar productos, poner modificaciones, imprimir la comanda y cobrar cuando corresponda.</p>
      <button className="primary landing-primary" onClick={() => setEditing(true)}><Plus size={18}/> Registrar nuevo pedido</button>
      <button className="landing-secondary" onClick={() => navigate('/pedidos')}>Ver pedidos de hoy</button>
    </div>
  </div>

  return <OrderWorkspace
    user={user}
    onClose={() => { setEditing(false); navigate('/pedidos') }}
  />
}
