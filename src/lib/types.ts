export type Role = 'manager' | 'admin' | 'employee'
export type PaymentMethod = 'cash' | 'transfer' | 'card'

export type Product = {
  id: string
  name: string
  category: 'Hamburguesas' | 'Combos' | 'Bebidas' | 'Acompañamientos'
  price: number
  active: boolean
}

export type SaleItem = {
  productId: string
  name: string
  quantity: number
  unitPrice: number
  total: number
}

export type Sale = {
  id: string
  createdAt: string
  userId: string
  userName: string
  payment: PaymentMethod
  items: SaleItem[]
  subtotal: number
  total: number
}

export type User = {
  id: string
  name: string
  role: Role
  pin: string
  rank: string
  active: boolean
}
