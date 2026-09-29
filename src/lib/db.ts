import Dexie, { type Table } from 'dexie'
import type { Order, Product, Sale, User } from './types'

class SmakyDB extends Dexie {
  sales!: Table<Sale, string>
  orders!: Table<Order, string>
  products!: Table<Product, string>
  users!: Table<User, string>
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
  }
}

export const db = new SmakyDB()
