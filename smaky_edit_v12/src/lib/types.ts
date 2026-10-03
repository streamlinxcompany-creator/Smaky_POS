export type Role = 'manager' | 'admin' | 'employee'
export type PermissionKey =
  | 'dashboard.view'
  | 'customers.manage'
  | 'pos.access'
  | 'sales.view'
  | 'sales.delete'
  | 'products.manage'
  | 'reports.view'
  | 'cashClosing.access'

export type PaymentMethod = string

export type OrderFieldType = 'text' | 'textarea'

export type OrderFieldConfig = {
  id: string
  label: string
  type: OrderFieldType
  enabled: boolean
  required: boolean
  system?: boolean
}

export type ThemeMode = 'light' | 'dark' | 'auto'

export type GeneralSettings = {
  themeMode: ThemeMode
  autoDarkFrom: string
  autoLightFrom: string
  showConsumerFinal: boolean
}

export type Customer = {
  id: string
  name: string
  phone: string
  address: string
  notes: string
  createdAt: string
  updatedAt: string
  active: boolean
  customFields?: Record<string, string>
}

export type PaymentMethodConfig = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}
export type OrderStatus = 'pending' | 'preparing' | 'ready' | 'delivered' | 'paid' | 'cancelled'

export type Product = {
  id: string
  name: string
  category: string
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
  customFields?: Record<string, string>
  customFieldLabels?: Record<string, string>
}

export type Order = DeliveryInfo & {
  id: string
  orderNumber: number
  createdAt: string
  updatedAt: string
  userId: string
  userName: string
  customerId?: string
  items: SaleItem[]
  subtotal: number
  total: number
  status: OrderStatus
  /** Periodo de caja al que pertenece el pedido. Mantiene la fecha operativa tras un cierre. */
  businessDateKey?: string
  deletedAt?: string
  deletedBy?: string
  /** Estado de impresión de cocina; no afecta el flujo de cobro. */
  comandaStatus?: 'printed' | 'skipped'
  comandaPrintedAt?: string
  comandaSkippedAt?: string
}

export type Sale = DeliveryInfo & {
  id: string
  createdAt: string
  userId: string
  userName: string
  customerId?: string
  payment: PaymentMethod
  paymentLabel?: string
  items: SaleItem[]
  subtotal: number
  total: number
  discountType?: 'percent' | 'fixed'
  discountValue?: number
  discountAmount?: number
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
  /** Desglose completo de cualquier medio de pago, incluyendo los personalizados. */
  payments?: Record<string, number>
  paymentLabels?: Record<string, string>
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
  permissions?: PermissionKey[]
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

export type SystemSetting = {
  id: string
  key: string
  value: unknown
  updatedAt: string
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
