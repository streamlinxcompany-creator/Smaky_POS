import Dexie, { type Table } from 'dexie'
import type {
  AuditEvent,
  BackupSnapshot,
  CashClosure,
  Customer,
  HistoryRecord,
  Order,
  Product,
  Sale,
  SystemSetting,
  User,
} from './types'

export type SyncEntity =
  | 'products'
  | 'customers'
  | 'orders'
  | 'sales'
  | 'cash_closures'
  | 'settings'
  | 'audit_events'
  | 'history_records'
  | 'backups'

export type UserSyncOperation = {
  id: string
  entity: 'users'
  operation: 'provision' | 'update' | 'delete'
  recordId: string
  payload: unknown
  createdAt: string
  attempts: number
  lastError?: string
}

export type DataSyncOperation = {
  id: string
  entity: SyncEntity | 'system'
  operation: 'upsert' | 'reset' | 'purge_sales' | 'purge_cash_closures' | 'reset_pos_virgin'
  recordId?: string
  payload?: unknown
  createdAt: string
  attempts: number
  lastError?: string
}

export type SyncOperation = DataSyncOperation | UserSyncOperation

export type SyncMeta = {
  id: string
  value: unknown
  updatedAt: string
}

export class SmakyDatabase extends Dexie {
  products!: Table<Product, string>
  customers!: Table<Customer, string>
  orders!: Table<Order, string>
  sales!: Table<Sale, string>
  users!: Table<User, string>
  closures!: Table<CashClosure, string>
  settings!: Table<SystemSetting, string>
  auditEvents!: Table<AuditEvent, string>
  historyRecords!: Table<HistoryRecord, string>
  backups!: Table<BackupSnapshot, string>
  syncQueue!: Table<SyncOperation, string>
  syncMeta!: Table<SyncMeta, string>

  constructor() {
    super('smaky-pos')

    this.version(1).stores({
      products: 'id, name, category, active, updatedAt, deletedAt',
      customers: 'id, phone, name, active, updatedAt',
      orders: 'id, orderNumber, createdAt, updatedAt, status, businessDateKey, customerId, userId, deletedAt',
      sales: 'id, createdAt, updatedAt, payment, orderId, businessDateKey, customerId, userId, deletedAt',
      users: 'id, legacyId, role, active, updatedAt, deletedAt',
      closures: 'id, dateKey, closedAt, updatedAt, deletedAt',
      settings: 'id, key, updatedAt',
      auditEvents: 'id, timestamp, actorId, module, action, recordType, recordId',
      historyRecords: 'id, [entity+recordId], capturedAt, eventId, deleted',
      backups: 'id, createdAt, kind',
      syncQueue: 'id, entity, operation, recordId, createdAt, attempts, [entity+recordId]',
      syncMeta: 'id, updatedAt',
    })

    // Version 2 formalizes the outbox/meta stores used by the current
    // offline-first synchronization layer. Existing installations are upgraded
    // without clearing their local records.
    this.version(2).stores({
      products: 'id, name, category, active, updatedAt, deletedAt',
      customers: 'id, phone, name, active, updatedAt',
      orders: 'id, orderNumber, createdAt, updatedAt, status, businessDateKey, customerId, userId, deletedAt',
      sales: 'id, createdAt, updatedAt, payment, orderId, businessDateKey, customerId, userId, deletedAt',
      users: 'id, legacyId, role, active, updatedAt, deletedAt',
      closures: 'id, dateKey, closedAt, updatedAt, deletedAt',
      settings: 'id, key, updatedAt',
      auditEvents: 'id, timestamp, actorId, module, action, recordType, recordId',
      historyRecords: 'id, [entity+recordId], capturedAt, eventId, deleted',
      backups: 'id, createdAt, kind',
      syncQueue: 'id, entity, operation, recordId, createdAt, attempts, [entity+recordId]',
      syncMeta: 'id, updatedAt',
    })
  }
}

export const db = new SmakyDatabase()

export type DbTable =
  | typeof db.products
  | typeof db.customers
  | typeof db.orders
  | typeof db.sales
  | typeof db.closures
  | typeof db.settings
  | typeof db.auditEvents
  | typeof db.historyRecords
  | typeof db.backups

