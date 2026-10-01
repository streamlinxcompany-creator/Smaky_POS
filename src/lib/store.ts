import { db } from './db'
import { products as seedProducts } from './demoData'
import type { CashClosure, Order, OrderStatus, Product, Role, Sale, User, DeliveryInfo, PaymentMethod } from './types'

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

const businessDayKey = (iso: string | Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date(iso))

export { businessDayKey }

export const recordBusinessDayKey = (record: { createdAt: string; businessDateKey?: string }) => record.businessDateKey || businessDayKey(record.createdAt)

export async function getCurrentBusinessDayKey() {
  const calendarKey = businessDayKey(new Date())
  const closure = await db.closures.where('dateKey').equals(calendarKey).first()
  return closure?.nextDateKey ?? calendarKey
}

export const addBusinessDay = (dateKey: string, amount = 1) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + amount)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export async function getClosures() {
  return db.closures.orderBy('closedAt').reverse().toArray()
}

export async function resetTestData(actor: User) {
  return db.transaction('rw', db.sales, db.orders, db.closures, async () => {
    const freshActor = await db.users.get(actor.id)
    if (!freshActor?.active || freshActor.role !== 'manager') return false

    await db.sales.clear()
    await db.orders.clear()
    await db.closures.clear()
    return true
  })
}


export async function getClosureByDate(dateKey: string) {
  return db.closures.where('dateKey').equals(dateKey).first()
}

export async function deletePreviousDayClosure(closureId: string, actor: User) {
  return db.transaction('rw', db.closures, db.users, async () => {
    const freshActor = await db.users.get(actor.id)
    if (!freshActor?.active || freshActor.role !== 'manager') return false

    const yesterdayKey = addBusinessDay(businessDayKey(new Date()), -1)
    const closure = await db.closures.get(closureId)
    if (!closure || closure.dateKey !== yesterdayKey) return false

    await db.closures.delete(closureId)
    return true
  })
}

export async function createDailyClosure(dateKey: string, actor: User, cashCounted: number, notes = '') {
  return db.transaction('rw', db.closures, db.sales, db.users, async () => {
    const freshActor = await db.users.get(actor.id)
    if (!freshActor?.active || !['manager', 'admin'].includes(freshActor.role)) return null
    if (await db.closures.where('dateKey').equals(dateKey).first()) throw new Error('Este día ya tiene un cierre registrado.')

    const sales = (await db.sales.toArray())
      .filter(sale => recordBusinessDayKey(sale) === dateKey)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

    const totals = sales.reduce((acc, sale) => {
      acc.total += sale.total
      if (sale.payment === 'cash') acc.cash += sale.total
      else if (sale.payment === 'transfer') acc.transfer += sale.total
      else acc.card += sale.total
      return acc
    }, { total: 0, cash: 0, transfer: 0, card: 0 })

    const counted = Number.isFinite(cashCounted) ? Math.max(0, cashCounted) : 0
    const closure: CashClosure = {
      id: crypto.randomUUID(),
      dateKey,
      closedAt: new Date().toISOString(),
      userId: freshActor.id,
      userName: freshActor.name,
      saleCount: sales.length,
      total: totals.total,
      cash: totals.cash,
      transfer: totals.transfer,
      card: totals.card,
      cashExpected: totals.cash,
      cashCounted: counted,
      cashDifference: counted - totals.cash,
      notes: notes.trim(),
      sales: sales.map(sale => ({ ...sale, items: sale.items.map(item => ({ ...item })) })),
      nextDateKey: addBusinessDay(dateKey, 1)
    }

    await db.closures.add(closure)
    return closure
  })
}

export async function getOrders() {
  return db.orders.orderBy('createdAt').reverse().toArray()
}

export async function createOrder(items: Order['items'], delivery: DeliveryInfo, user: User) {
  const now = new Date()
  const calendarKey = businessDayKey(now)
  const closure = await db.closures.where('dateKey').equals(calendarKey).first()
  const businessDateKey = closure?.nextDateKey ?? calendarKey
  const existing = await db.orders.toArray()
  const todayOrders = existing.filter(order => recordBusinessDayKey(order) === businessDateKey)
  const nextNumber = todayOrders.reduce((max, order) => Math.max(max, Number(order.orderNumber) || 0), 0) + 1
  const cleanItems = items.map(item => ({ ...item, modification: item.modification?.trim() || undefined }))
  const total = cleanItems.reduce((sum, item) => sum + item.total, 0)
  const order: Order = {
    id: crypto.randomUUID(),
    orderNumber: nextNumber,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    userId: user.id,
    userName: user.name,
    customerName: delivery.customerName || '',
    phone: delivery.phone || '',
    address: delivery.address || '',
    notes: delivery.notes || '',
    items: cleanItems,
    subtotal: total,
    total,
    status: 'pending',
    businessDateKey
  }
  await db.orders.add(order)
  return order
}

export async function updateOrderItems(orderId: string, items: Order['items'], notes?: string) {
  const order = await db.orders.get(orderId)
  if (!order || ['paid', 'cancelled'].includes(order.status) || !items.length) return order ?? null
  const cleanItems = items.map(item => ({ ...item, modification: item.modification?.trim() || undefined }))
  const subtotal = cleanItems.reduce((sum, item) => sum + item.total, 0)
  await db.orders.update(orderId, { items: cleanItems, subtotal, total: subtotal, ...(notes !== undefined ? { notes: notes.trim() } : {}), updatedAt: new Date().toISOString() })
  return db.orders.get(orderId)
}

export async function getSaleForOrder(orderId: string) {
  return db.sales.where('orderId').equals(orderId).first()
}

export async function updateOrderStatus(orderId: string, status: OrderStatus) {
  const order = await db.orders.get(orderId)
  if (!order || ['paid', 'cancelled'].includes(order.status)) return order ?? null
  await db.orders.update(orderId, { status, updatedAt: new Date().toISOString() })
  return db.orders.get(orderId)
}

export async function completeOrder(orderId: string, payment: PaymentMethod, actor: User) {
  return db.transaction('rw', db.orders, db.sales, db.users, db.closures, async () => {
    const [order, freshActor] = await Promise.all([db.orders.get(orderId), db.users.get(actor.id)])
    if (!order || !freshActor?.active || ['paid', 'cancelled'].includes(order.status)) return null
    const businessDateKey = recordBusinessDayKey(order)
    if (await db.closures.where('dateKey').equals(businessDateKey).first()) throw new Error(`El periodo del ${businessDateKey.split('-').reverse().join('/')} ya fue cerrado. Registra el pedido en el siguiente periodo.`)

    const sale: Sale = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      userId: freshActor.id,
      userName: freshActor.name,
      payment,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      phone: order.phone,
      address: order.address,
      notes: order.notes,
      items: order.items.map(item => ({ ...item })),
      subtotal: order.subtotal,
      total: order.total,
      businessDateKey
    }

    await db.sales.add(sale)
    await db.orders.update(order.id, { status: 'paid', updatedAt: new Date().toISOString() })
    return { sale, order: await db.orders.get(order.id) as Order }
  })
}

export async function deleteSale(targetId: string, actorId: string) {
  const actor = await db.users.get(actorId)
  if (!actor || !actor.active || !['manager', 'admin'].includes(actor.role)) return false
  const sale = await db.sales.get(targetId)
  if (!sale) return false
  await db.sales.delete(targetId)
  return true
}

export async function deleteProduct(targetId: string, actorId: string) {
  const actor = await db.users.get(actorId)
  if (!actor || !actor.active || actor.role !== 'manager') return false
  const product = await db.products.get(targetId)
  if (!product) return false
  await db.products.delete(targetId)
  return true
}

export async function deleteOrder(targetId: string, actorId: string) {
  const actor = await db.users.get(actorId)
  if (!actor || !actor.active || actor.role !== 'manager') return false
  const order = await db.orders.get(targetId)
  if (!order || order.status === 'paid') return false
  await db.orders.delete(targetId)
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

  if (target.role === 'manager') {
    if (target.id !== actor.id) return target
    if (wantsRoleChange || wantsActiveChange) return target
  }

  if (wantsRoleChange && !actorIsManager) return target
  if (wantsRoleChange && !['admin', 'employee'].includes(changes.role as string)) return target
  if (target.role === 'admin' && changes.role === 'employee' && !actorIsManager) return target

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
