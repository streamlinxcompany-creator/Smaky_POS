import { db } from './db'
import { products as seedProducts } from './demoData'
import type { Product, Role, Sale, User } from './types'

const seedManager: User = {
  id: 'u-owner',
  name: 'Gerente',
  role: 'manager',
  pin: '1234',
  rank: 'Gerente General',
  active: true
}

export async function seed() {
  if ((await db.products.count()) === 0) await db.products.bulkAdd(seedProducts)

  await db.users.delete('u-demo-worker')
  const oldDemoUsers = await db.users.toArray()
  const demoIds = oldDemoUsers.filter(user => /demo/i.test(user.name)).map(user => user.id)
  if (demoIds.length) await db.users.bulkDelete(demoIds)

  const users = await db.users.toArray()
  for (const user of users) {
    const role = (user as User & { role?: string }).role as string | undefined
    if (role === 'owner') {
      await db.users.update(user.id, user.id === 'u-owner'
        ? { name: 'Gerente', role: 'manager', rank: 'Gerente General', active: true }
        : { role: 'admin', rank: user.rank || 'Administrador' })
    } else if (!(user as Partial<User>).rank) {
      await db.users.update(user.id, { rank: role === 'manager' ? 'Gerente General' : role === 'admin' ? 'Administrador' : 'Trabajador' })
    }
  }

  if (!(await db.users.get(seedManager.id))) await db.users.add(seedManager)

  const demoSales = await db.sales.toCollection().filter(sale => sale.id.startsWith('demo-')).primaryKeys()
  if (demoSales.length) await db.sales.bulkDelete(demoSales as string[])
}

export async function getProducts() {
  const products = await db.products.toArray()
  return products.filter(product => product.active)
}

export async function getAllProducts() {
  const products = await db.products.toArray()
  return products.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export async function saveProduct(product: Product) {
  await db.products.put(product)
  return product
}

export async function getSales() {
  return db.sales.orderBy('createdAt').reverse().toArray()
}

export async function addSale(sale: Sale) {
  await db.sales.add(sale)
  return sale
}

export async function deleteSale(targetId: string, actorId: string) {
  const actor = await db.users.get(actorId)
  if (!actor || !actor.active || !['manager', 'admin'].includes(actor.role)) return false
  const sale = await db.sales.get(targetId)
  if (!sale) return false
  await db.sales.delete(targetId)
  return true
}

export async function replaceProducts(products: Product[]) {
  await db.products.clear()
  await db.products.bulkAdd(products)
}

export async function getUsers() {
  const users = await db.users.toArray()
  return users.sort((a, b) => {
    const roleOrder: Record<Role, number> = { manager: 0, admin: 1, employee: 2 }
    return roleOrder[a.role] - roleOrder[b.role] || a.name.localeCompare(b.name, 'es')
  })
}

export async function createWorker(name: string, pin: string, rank: string) {
  const user: User = {
    id: crypto.randomUUID(),
    name: name.trim(),
    role: 'employee',
    pin,
    rank: rank.trim(),
    active: true
  }
  await db.users.add(user)
  return user
}

export type UserSettings = Pick<User, 'name' | 'pin' | 'rank' | 'active' | 'role'>

export async function updateUserSettings(targetId: string, changes: Partial<UserSettings>, actorId: string) {
  const [actor, target] = await Promise.all([db.users.get(actorId), db.users.get(targetId)])
  if (!actor || !target || !actor.active) return target

  const safeChanges: Partial<UserSettings> = {}
  if (typeof changes.name === 'string' && changes.name.trim().length >= 2) safeChanges.name = changes.name.trim()
  if (typeof changes.pin === 'string' && /^\d{4}$/.test(changes.pin)) safeChanges.pin = changes.pin
  if (typeof changes.rank === 'string' && changes.rank.trim().length >= 2) safeChanges.rank = changes.rank.trim()

  const wantsRoleChange = changes.role !== undefined && changes.role !== target.role
  const wantsActiveChange = changes.active !== undefined && changes.active !== target.active
  const actorIsManager = actor.role === 'manager'

  // El Gerente es único y no puede degradarse, desactivarse ni convertirse en otra cosa.
  if (target.role === 'manager') {
    if (target.id !== actor.id) return target
    if (wantsRoleChange || wantsActiveChange) return target
  }

  // Solo el Gerente puede crear/quitar/degradar Administradores o promover trabajadores.
  if (wantsRoleChange && !actorIsManager) return target
  if (wantsRoleChange && !['admin', 'employee'].includes(changes.role as string)) return target
  if (target.role === 'admin' && changes.role === 'employee' && !actorIsManager) return target

  // Nadie puede desactivar su propia sesión.
  if (target.id === actor.id && wantsActiveChange) return target

  if (wantsActiveChange && target.role === 'admin' && !actorIsManager) return target
  if (wantsActiveChange && target.role === 'manager') return target

  if (wantsRoleChange) safeChanges.role = changes.role
  if (wantsActiveChange) safeChanges.active = changes.active

  if (Object.keys(safeChanges).length) await db.users.update(targetId, safeChanges)
  return db.users.get(targetId)
}

export async function deleteUserProfile(targetId: string, actorId: string) {
  const [actor, target] = await Promise.all([db.users.get(actorId), db.users.get(targetId)])
  if (!actor || !target || !actor.active) return false
  if (target.id === actor.id || target.role === 'manager') return false
  if (target.role === 'admin' && actor.role !== 'manager') return false
  if (target.role === 'employee' && !['manager', 'admin'].includes(actor.role)) return false
  await db.users.delete(targetId)
  return true
}
