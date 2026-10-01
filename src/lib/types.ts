export type Role = 'manager' | 'admin' | 'employee'
export type PaymentMethod = 'cash' | 'transfer' | 'card'
export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'delivered' | 'paid' | 'cancelled'

export type Product = {
  id: string
  name: string
  category: 'Hamburguesas' | 'Combos' | 'Bebidas' | 'Acompañamientos'
  price: number
  active: boolean
  /** Registro retirado de la operación; sólo StreamLinx lo consulta. */
  deletedAt?: string
  deletedBy?: string
}

export type SaleItem = {
  lineId?: string
  productId: string
  name: string
  category?: Product['category']
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
  /** Periodo de caja al que pertenece el pedido. Mantiene la fecha operativa tras un cierre. */
  businessDateKey?: string
  deletedAt?: string
  deletedBy?: string
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
  /** Periodo de caja al que pertenece la venta. Mantiene la fecha operativa tras un cierre. */
  businessDateKey?: string
  orderId?: string
  orderNumber?: number
  deletedAt?: string
  deletedBy?: string
}

export type CashClosure = {
  id: string
  dateKey: string
  closedAt: string
  userId: string
  userName: string
  saleCount: number
  total: number
  cash: number
  transfer: number
  card: number
  cashExpected: number
  cashCounted: number
  cashDifference: number
  notes: string
  sales: Sale[]
  nextDateKey: string
  deletedAt?: string
  deletedBy?: string
}

export type User = {
  id: string
  name: string
  role: Role
  pin: string
  rank: string
  active: boolean
  deletedAt?: string
  deletedBy?: string
}

export type AuditEvent = {
  id: string
  timestamp: string
  actorId?: string
  actorName: string
  role?: Role
  module: string
  action: string
  recordType: string
  recordId?: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  reason?: string
}

export type HistoryRecord = {
  id: string
  entity: string
  recordId: string
  version: number
  capturedAt: string
  eventId: string
  snapshot: Record<string, unknown>
  deleted?: boolean
}

export type BackupSnapshot = {
  id: string
  createdAt: string
  createdBy: string
  kind: 'manual' | 'pre-destructive' | 'pre-restore'
  label: string
  size: number
  contents: Record<string, number>
  payload: Record<string, unknown>
}
