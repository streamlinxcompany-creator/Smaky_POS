import Dexie, { type Table } from 'dexie'
import type { AuditEvent, BackupSnapshot, HistoryRecord, Order, Product, Sale, SystemSetting, User } from './types'

class SmakyDB extends Dexie {
  sales!: Table<Sale, string>
  orders!: Table<Order, string>
  products!: Table<Product, string>
  users!: Table<User, string>
  closures!: Table<import('./types').CashClosure, string>
  auditEvents!: Table<AuditEvent, string>
  historyRecords!: Table<HistoryRecord, string>
  backups!: Table<BackupSnapshot, string>
  settings!: Table<SystemSetting, string>
  constructor() {
    super('smaky-pos-db')
    this.version(1).stores({ sales: 'id, createdAt, payment, userId', products: 'id, category, active' })
    this.version(2).stores({ sales: 'id, createdAt, payment, userId', products: 'id, category, active', users: 'id, name, role, active' })
    this.version(3).stores({
      sales: 'id, createdAt, payment, userId, orderId, orderNumber',
      orders: 'id, createdAt, updatedAt, orderNumber, status, userId',
      products: 'id, category, active',
      users: 'id, name, role, active'
    })
    this.version(4).stores({
      sales: 'id, createdAt, payment, userId, orderId, orderNumber',
      orders: 'id, createdAt, updatedAt, orderNumber, status, userId',
      products: 'id, category, active',
      users: 'id, name, role, active',
      closures: 'id, dateKey, closedAt, userId'
    })
    this.version(5).stores({
      sales: 'id, createdAt, businessDateKey, payment, userId, orderId, orderNumber',
      orders: 'id, createdAt, businessDateKey, updatedAt, orderNumber, status, userId',
      products: 'id, category, active',
      users: 'id, name, role, active',
      closures: 'id, dateKey, closedAt, userId'
    })
    this.version(6).stores({
      sales: 'id, createdAt, businessDateKey, payment, userId, orderId, orderNumber, deletedAt',
      orders: 'id, createdAt, businessDateKey, updatedAt, orderNumber, status, userId, deletedAt',
      products: 'id, category, active, deletedAt',
      users: 'id, name, role, active, deletedAt',
      closures: 'id, dateKey, closedAt, userId, deletedAt',
      auditEvents: 'id, timestamp, actorId, module, action, recordType, recordId',
      historyRecords: 'id, entity, recordId, version, capturedAt, eventId, [entity+recordId]',
      backups: 'id, createdAt, kind'
    })
    // Fuerza la creación de las tablas internas en instalaciones que ya abrieron
    // una versión previa del Command Center antes de que existieran estos stores.
    this.version(7).stores({
      sales: 'id, createdAt, businessDateKey, payment, userId, orderId, orderNumber, deletedAt',
      orders: 'id, createdAt, businessDateKey, updatedAt, orderNumber, status, userId, deletedAt',
      products: 'id, category, active, deletedAt',
      users: 'id, name, role, active, deletedAt',
      closures: 'id, dateKey, closedAt, userId, deletedAt',
      auditEvents: 'id, timestamp, actorId, module, action, recordType, recordId',
      historyRecords: 'id, entity, recordId, version, capturedAt, eventId, [entity+recordId]',
      backups: 'id, createdAt, kind'
    })
    this.version(8).stores({
      sales: 'id, createdAt, businessDateKey, payment, userId, orderId, orderNumber, deletedAt',
      orders: 'id, createdAt, businessDateKey, updatedAt, orderNumber, status, userId, deletedAt',
      products: 'id, category, active, deletedAt',
      users: 'id, name, role, active, deletedAt',
      closures: 'id, dateKey, closedAt, userId, deletedAt',
      auditEvents: 'id, timestamp, actorId, module, action, recordType, recordId',
      historyRecords: 'id, entity, recordId, capturedAt, eventId, [entity+recordId]',
      backups: 'id, createdAt, kind',
      settings: 'id, key, updatedAt'
    })
  }
}

export const db = new SmakyDB()
