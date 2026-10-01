import Dexie, { type Table } from 'dexie'
import type { Order, Product, Sale, User } from './types'

class SmakyDB extends Dexie {
  sales!: Table<Sale, string>
  orders!: Table<Order, string>
  products!: Table<Product, string>
  users!: Table<User, string>
  closures!: Table<import('./types').CashClosure, string>
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
  }
}

export const db = new SmakyDB()
