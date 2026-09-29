export type Role = 'manager' | 'admin' | 'employee'
export type PaymentMethod = 'cash' | 'transfer' | 'card'
export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'delivered' | 'paid' | 'cancelled'

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
  modification?: string
}

export type DeliveryInfo = {
  customerName: string
  phone: string
  address: string
  notes: string
}

export type Order = DeliveryInfo & {
  id: string
  orderNumber: number
  createdAt: string
  updatedAt: string
  userId: string
  userName: string
  items: SaleItem[]
  subtotal: number
  total: number
  status: OrderStatus
}

export type Sale = DeliveryInfo & {
  id: string
  createdAt: string
  userId: string
  userName: string
  payment: PaymentMethod
  items: SaleItem[]
  subtotal: number
  total: number
  orderId?: string
  orderNumber?: number
}

export type User = {
  id: string
  name: string
  role: Role
  pin: string
  rank: string
  active: boolean
}
