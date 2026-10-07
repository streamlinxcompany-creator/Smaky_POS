import { db } from './db'
import type { Table } from 'dexie'
import { applyLocalSalesPurge, enqueueEntityUpsert, enqueueResetOperation, enqueueSalesPurgeOperation, enqueueUserDelete, enqueueUserProvision, enqueueUserUpdate, ensureRemoteSession, isNetworkError, purgeRemoteSales, resetRemoteData, withSyncSuppressed } from './sync'
import { products as seedProducts } from './demoData'
import { createRemoteWorker, defaultPermissionsForRole, deleteRemoteUser, getLoginProfiles, getManagedProfile, getSessionUser, hasPermission, isStreamlinxOperator, setSessionUser, updateRemoteUser } from './auth'
import type { AuditEvent, BackupSnapshot, CashClosure, Customer, HistoryRecord, Order, OrderStatus, Product, Role, Sale, User, DeliveryInfo, PaymentMethod, SystemSetting, PaymentMethodConfig, PermissionKey } from './types'

type Auditable = Record<string, unknown>
const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(pin|password|token|secret|cookie)/i.test(key))
    .map(([key, item]) => [key, redact(item)]))
}
const actorFromSession = () => getSessionUser()
type SyncableRecord = { id: string }

async function persistPut<T extends SyncableRecord>(table: Table<T, string>, entity: Parameters<typeof enqueueEntityUpsert>[0], value: T) {
  // No mantenemos una transacción Dexie abierta mientras la outbox dispara
  // tareas de sincronización. Esto evita que un segundo ciclo IndexedDB deje
  // la transacción original inactiva y produzca "Transaction committed too early".
  await table.put(value)
  await enqueueEntityUpsert(entity, value.id, value)
  return value
}

async function persistAdd<T extends SyncableRecord>(table: Table<T, string>, entity: Parameters<typeof enqueueEntityUpsert>[0], value: T) {
  await table.add(value)
  await enqueueEntityUpsert(entity, value.id, value)
  return value
}

async function audit(action: string, module: string, recordType: string, recordId?: string, before?: unknown, after?: unknown, actor = actorFromSession(), reason?: string) {
  const event: AuditEvent = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), actorId: actor?.id, actorName: actor?.name || 'Sistema', role: actor?.role, module, action, recordType, recordId, before: (redact(before) as Auditable | null) ?? null, after: (redact(after) as Auditable | null) ?? null, reason }
  try {
    await db.auditEvents.add(event)
    await enqueueEntityUpsert('audit_events', event.id, event)
    if (recordId && after && typeof after === 'object') {
      const versions = await db.historyRecords.where('[entity+recordId]').equals([recordType, recordId]).count()
      const snapshot: HistoryRecord = { id: crypto.randomUUID(), entity: recordType, recordId, version: versions + 1, capturedAt: event.timestamp, eventId: event.id, snapshot: redact(after) as Auditable, deleted: Boolean((after as { deletedAt?: string }).deletedAt) }
      await db.historyRecords.add(snapshot)
      await enqueueEntityUpsert('history_records', snapshot.id, snapshot)
    }
  } catch (error) {
    // La auditoría nunca debe borrar ni bloquear la operación principal.
    // A diferencia de la versión anterior, ya no se usa localStorage: si IndexedDB
    // falla, el error queda visible para diagnóstico y la operación de negocio ya
    // permanece protegida en sus propias tablas/outbox transaccionales.
    console.warn('Smaky audit write failed:', error)
  }
  return event
}

export async function getAuditEvents() { return db.auditEvents.orderBy('timestamp').reverse().toArray() }
export async function getHistoryRecords() { return db.historyRecords.orderBy('capturedAt').reverse().toArray() }
export async function getArchivedSales() { return db.sales.orderBy('createdAt').reverse().toArray() }
export async function getArchivedOrders() { return db.orders.orderBy('createdAt').reverse().toArray() }
export async function getArchivedProducts() { return db.products.toArray() }
export async function getArchivedUsers() { return db.users.toArray() }
export async function getArchivedClosures() { return db.closures.orderBy('closedAt').reverse().toArray() }

export async function createBackupSnapshot(actor: User, kind: BackupSnapshot['kind'], label: string) {
  const [sales, orders, products, users, closures, customers, events, history, settings] = await Promise.all([db.sales.toArray(), db.orders.toArray(), db.products.toArray(), db.users.toArray(), db.closures.toArray(), db.customers.toArray(), db.auditEvents.toArray(), db.historyRecords.toArray(), db.settings.toArray()])
  const payload = redact({ sales, orders, products, users, closures, customers, events, history, settings }) as Record<string, unknown>
  const contents = { sales: sales.length, orders: orders.length, products: products.length, users: users.length, closures: closures.length, customers: customers.length, audit: events.length, history: history.length, settings: settings.length }
  const backup: BackupSnapshot = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), createdBy: actor.name, kind, label, contents, size: new Blob([JSON.stringify(payload)]).size, payload }
  await persistAdd(db.backups, 'backups', backup)
  await audit('SYSTEM_BACKUP_CREATED', 'BACKUPS', 'backup', backup.id, null, { id: backup.id, label, contents, size: backup.size }, actor)
  return backup
}

export async function getBackupSnapshots() { return db.backups.orderBy('createdAt').reverse().toArray() }

export async function restoreArchivedRecord(entity: string, recordId: string, actor: User) {
  const now = new Date().toISOString()

  if (entity === 'user') {
    const record = await db.users.get(recordId)
    if (!record?.deletedAt) return false

    const before = { ...record, pin: undefined }
    const restoredLocal: User = {
      ...record,
      active: true,
      deletedAt: undefined,
      deletedBy: undefined,
      updatedAt: now,
    }

    let finalUser = restoredLocal
    let remote: Awaited<ReturnType<typeof createRemoteWorker>> | null = null
    if (navigator.onLine && await ensureRemoteSession()) {
      try {
        remote = await createRemoteWorker(restoredLocal.name, restoredLocal.pin, restoredLocal.rank, restoredLocal.legacyId || restoredLocal.id)
      } catch (error) {
        if (!isNetworkError(error)) throw error
      }
    }

    if (remote) {
      finalUser = {
        ...restoredLocal,
        id: remote.id,
        legacyId: remote.legacyId || restoredLocal.legacyId || restoredLocal.id,
        authEmail: remote.authEmail,
        name: remote.name,
        role: remote.role,
        rank: remote.rank,
        active: remote.active,
        permissions: remote.permissions,
        updatedAt: now,
      }
      await withSyncSuppressed(async () => {
        if (finalUser.id !== record.id) await db.users.delete(record.id)
        await db.users.put(finalUser)
      })
    } else {
      await withSyncSuppressed(async () => { await db.users.put(restoredLocal) })
      await enqueueUserProvision(restoredLocal)
    }

    await audit('USER_RESTORED', 'RECOVERY', 'user', recordId, before, { ...finalUser, pin: undefined }, actor)
    return true
  }

  const table = entity === 'sale' ? db.sales : entity === 'order' ? db.orders : entity === 'product' ? db.products : entity === 'customer' ? db.customers : db.closures
  const record = await table.get(recordId) as (Auditable & { deletedAt?: string }) | undefined
  if (!record?.deletedAt) return false
  const before = { ...record }
  const after = { ...record }; delete after.deletedAt; delete after.deletedBy
  if ('updatedAt' in after) (after as Record<string, unknown>).updatedAt = now
  await persistPut(table as Table<{ id: string }, string>, entity as Parameters<typeof enqueueEntityUpsert>[0], after as { id: string })
  await audit(`${entity.toUpperCase()}_RESTORED`, 'RECOVERY', entity, recordId, before, after, actor)
  return true
}

const SEED_BASELINE_UPDATED_AT = '2000-01-01T00:00:00.000Z'
export const DEFAULT_PRODUCT_CATEGORIES = ['Hamburguesas', 'Combos', 'Acompañamientos', 'Bebidas']
const CATEGORY_SETTING_KEY = 'productCategories'
const PAYMENT_METHODS_SETTING_KEY = 'paymentMethods'
export const ORDER_FIELDS_SETTING_KEY = 'orderFields'
export const GENERAL_SETTINGS_KEY = 'generalSettings'

export const DEFAULT_ORDER_FIELDS: import('./types').OrderFieldConfig[] = [
  { id: 'name', label: 'Nombre', type: 'text', enabled: true, required: true, system: true },
  { id: 'phone', label: 'Número', type: 'phone', enabled: true, required: true, system: true },
  { id: 'address', label: 'Dirección', type: 'address', enabled: true, required: false, system: true },
  { id: 'notes', label: 'Observaciones', type: 'textarea', enabled: true, required: false, system: true },
]

export const DEFAULT_GENERAL_SETTINGS: import('./types').GeneralSettings = {
  themeMode: 'dark',
  autoDarkFrom: '19:00',
  autoLightFrom: '07:00',
  showConsumerFinal: false,
  receiptFontSize: 10,
}

export const DEFAULT_PAYMENT_METHODS: PaymentMethodConfig[] = [
  { id: 'cash', name: 'Efectivo', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'transfer', name: 'Transferencia', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'card', name: 'Tarjeta', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
]

const seedManager: User = {
  id: 'u-owner',
  name: 'Gerente',
  role: 'manager',
  pin: '1234',
  rank: 'Gerente General',
  active: true,
  permissions: ['dashboard.view','pos.access','customers.manage','customers.export','sales.view','sales.delete','products.manage','reports.view','cashClosing.access'],
  authEmail: 'u-owner@smaky.local',
  legacyId: 'u-owner',
  updatedAt: '2026-01-01T00:00:00.000Z'
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

  const currentUsers = await db.users.toArray()
  const allPermissionKeys: PermissionKey[] = ['dashboard.view','pos.access','customers.manage','customers.export','sales.view','sales.delete','products.manage','reports.view','cashClosing.access']
  for (const user of currentUsers) {
    const permissions = user.permissions?.length
      ? Array.from(new Set([...user.permissions, 'customers.manage' as PermissionKey, ...(user.role === 'admin' ? ['customers.export' as PermissionKey] : [])]))
      : user.role === 'employee'
        ? ['dashboard.view','pos.access','customers.manage','sales.view','cashClosing.access'] as PermissionKey[]
        : allPermissionKeys
    await db.users.update(user.id, { permissions, ...(user.updatedAt ? {} : { updatedAt: new Date().toISOString() }) })
    const sessionUser = getSessionUser()
    if (sessionUser?.id === user.id) setSessionUser({ ...user, permissions })
  }

  const categorySetting = await db.settings.get(CATEGORY_SETTING_KEY)
  if (!categorySetting) {
    const setting: SystemSetting = { id: CATEGORY_SETTING_KEY, key: CATEGORY_SETTING_KEY, value: DEFAULT_PRODUCT_CATEGORIES, updatedAt: SEED_BASELINE_UPDATED_AT }
    await db.settings.put(setting)
  }

  const orderFieldsSetting = await db.settings.get(ORDER_FIELDS_SETTING_KEY)
  if (!orderFieldsSetting || !Array.isArray(orderFieldsSetting.value)) {
    await db.settings.put({ id: ORDER_FIELDS_SETTING_KEY, key: ORDER_FIELDS_SETTING_KEY, value: DEFAULT_ORDER_FIELDS, updatedAt: SEED_BASELINE_UPDATED_AT })
  }

  const generalSetting = await db.settings.get(GENERAL_SETTINGS_KEY)
  if (!generalSetting || !generalSetting.value || typeof generalSetting.value !== 'object') {
    await db.settings.put({ id: GENERAL_SETTINGS_KEY, key: GENERAL_SETTINGS_KEY, value: DEFAULT_GENERAL_SETTINGS, updatedAt: SEED_BASELINE_UPDATED_AT })
  }

  const paymentSetting = await db.settings.get(PAYMENT_METHODS_SETTING_KEY)
  if (!paymentSetting || !Array.isArray(paymentSetting.value)) {
    await db.settings.put({ id: PAYMENT_METHODS_SETTING_KEY, key: PAYMENT_METHODS_SETTING_KEY, value: DEFAULT_PAYMENT_METHODS, updatedAt: SEED_BASELINE_UPDATED_AT })
  }

  const demoSales = await db.sales.toCollection().filter(sale => sale.id.startsWith('demo-')).primaryKeys()
  if (demoSales.length) await db.sales.bulkDelete(demoSales as string[])
}

export async function getProducts() {
  const products = await db.products.toArray()
  return products.filter(product => product.active && !product.deletedAt)
}

export async function getAllProducts() {
  const products = await db.products.toArray()
  return products.filter(product => !product.deletedAt).sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

const ORDER_FIELD_TYPES: import('./types').OrderFieldType[] = ['text', 'textarea', 'number', 'phone', 'address', 'select']

const normalizeOrderField = (field: Partial<import('./types').OrderFieldConfig>): import('./types').OrderFieldConfig => {
  const id = String(field.id || '').trim()
  const legacySystemType = id === 'phone' ? 'phone' : id === 'address' ? 'address' : id === 'notes' ? 'textarea' : 'text'
  const type = field.system && ['name', 'phone', 'address', 'notes'].includes(id)
    ? legacySystemType
    : ORDER_FIELD_TYPES.includes(field.type as import('./types').OrderFieldType) ? field.type as import('./types').OrderFieldType : legacySystemType
  const options = Array.isArray(field.options)
    ? Array.from(new Set(field.options.map(value => String(value).trim()).filter(Boolean))).slice(0, 50)
    : undefined

  return {
    id,
    label: String(field.label || '').trim().replace(/\s+/g, ' '),
    type,
    enabled: Boolean(field.enabled),
    required: Boolean(field.required),
    ...(options?.length ? { options } : {}),
    system: Boolean(field.system),
  }
}

export async function getOrderFields(): Promise<import('./types').OrderFieldConfig[]> {
  const setting = await db.settings.get(ORDER_FIELDS_SETTING_KEY)
  const value = setting?.value
  const fields = Array.isArray(value) ? value.map(item => normalizeOrderField(item as import('./types').OrderFieldConfig)) : DEFAULT_ORDER_FIELDS.map(item => normalizeOrderField(item))
  const ids = new Set(fields.map(field => field.id))
  const requiredSystemFields = DEFAULT_ORDER_FIELDS.filter(field => field.system && !ids.has(field.id)).map(field => normalizeOrderField(field))
  return [...requiredSystemFields, ...fields]
}

export async function updateOrderFields(fields: import('./types').OrderFieldConfig[], actor: User) {
  const normalized = fields
    .map(field => normalizeOrderField(field))
    .filter(field => field.id && field.label)

  const ids = new Set<string>()
  for (const field of normalized) {
    if (ids.has(field.id)) throw new Error('Hay campos de pedido repetidos.')
    ids.add(field.id)

    if (field.system && ['name', 'phone'].includes(field.id)) {
      field.enabled = true
      field.required = true
    }

    if (field.type === 'select' && (!field.options || field.options.length === 0)) {
      throw new Error(`El campo “${field.label}” necesita al menos una opción.`)
    }

    if (!field.enabled) field.required = false
  }

  const before = await getOrderFields()
  const now = new Date().toISOString()

  await persistPut(db.settings, 'settings', {
    id: ORDER_FIELDS_SETTING_KEY,
    key: ORDER_FIELDS_SETTING_KEY,
    value: normalized,
    updatedAt: now
  })

  await audit(
    'ORDER_FIELDS_UPDATED',
    'SETTINGS',
    'setting',
    ORDER_FIELDS_SETTING_KEY,
    { fields: before },
    { fields: normalized },
    actor
  )

  window.dispatchEvent(new CustomEvent('smaky-settings-change', {
    detail: { key: ORDER_FIELDS_SETTING_KEY }
  }))

  return normalized
}

export async function getGeneralSettings(): Promise<import('./types').GeneralSettings> {
  const setting = await db.settings.get(GENERAL_SETTINGS_KEY)
  const value = setting?.value
  if (value && typeof value === 'object') {
    return {
      ...DEFAULT_GENERAL_SETTINGS,
      ...(value as Partial<import('./types').GeneralSettings>)
    }
  }

  return { ...DEFAULT_GENERAL_SETTINGS }
}

export async function updateGeneralSettings(changes: Partial<import('./types').GeneralSettings>, actor: User) {
  const before = await getGeneralSettings()

  const next: import('./types').GeneralSettings = {
    ...before,
    ...changes,
    themeMode: changes.themeMode === 'light' || changes.themeMode === 'auto' || changes.themeMode === 'dark'
      ? changes.themeMode
      : before.themeMode,
    autoDarkFrom: /^([01]\d|2[0-3]):[0-5]\d$/.test(changes.autoDarkFrom || '')
      ? changes.autoDarkFrom!
      : before.autoDarkFrom,
    autoLightFrom: /^([01]\d|2[0-3]):[0-5]\d$/.test(changes.autoLightFrom || '')
      ? changes.autoLightFrom!
      : before.autoLightFrom,
    showConsumerFinal: changes.showConsumerFinal ?? before.showConsumerFinal,
  }

  const now = new Date().toISOString()

  await persistPut(db.settings, 'settings', {
    id: GENERAL_SETTINGS_KEY,
    key: GENERAL_SETTINGS_KEY,
    value: next,
    updatedAt: now
  })

  await audit('GENERAL_SETTINGS_UPDATED', 'SETTINGS', 'setting', GENERAL_SETTINGS_KEY, before, next, actor)

  window.dispatchEvent(new CustomEvent('smaky-settings-change', {
    detail: { key: GENERAL_SETTINGS_KEY }
  }))

  return next
}

export async function getProductCategories() {
  const setting = await db.settings.get(CATEGORY_SETTING_KEY)
  const value = setting?.value

  if (Array.isArray(value)) {
    const cleaned = value.map(item => String(item).trim()).filter(Boolean)
    if (cleaned.length) return cleaned
  }

  return [...DEFAULT_PRODUCT_CATEGORIES]
}

export async function addProductCategory(name: string, actor: User) {
  const cleanName = name.trim().replace(/\s+/g, ' ')

  if (cleanName.length < 2) throw new Error('La categoría debe tener al menos 2 caracteres.')
  if (cleanName.length > 40) throw new Error('La categoría no puede superar 40 caracteres.')
  if (cleanName.toLowerCase() === 'todos') throw new Error('Ese nombre está reservado para el filtro general del punto de venta.')

  const current = await getProductCategories()

  if (current.some(item => item.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error('Esa categoría ya existe.')
  }

  const next = [...current, cleanName]

  await persistPut(db.settings, 'settings', {
    id: CATEGORY_SETTING_KEY,
    key: CATEGORY_SETTING_KEY,
    value: next,
    updatedAt: new Date().toISOString()
  })

  await audit(
    'PRODUCT_CATEGORY_CREATED',
    'SETTINGS',
    'setting',
    CATEGORY_SETTING_KEY,
    { categories: current },
    { categories: next, added: cleanName },
    actor
  )

  return next
}

export async function deleteProductCategory(name: string, actor: User) {
  const current = await getProductCategories()
  const found = current.find(item => item.toLowerCase() === name.trim().toLowerCase())

  if (!found) return current
  if (DEFAULT_PRODUCT_CATEGORIES.includes(found)) {
    throw new Error('Las categorías base del sistema no se pueden eliminar.')
  }

  const products = await db.products.toArray()
  const inUse = products.some(
    product => !product.deletedAt && product.category.toLowerCase() === found.toLowerCase()
  )

  if (inUse) {
    throw new Error('No puedes eliminar una categoría que está asignada a un producto.')
  }

  const next = current.filter(item => item !== found)

  await persistPut(db.settings, 'settings', {
    id: CATEGORY_SETTING_KEY,
    key: CATEGORY_SETTING_KEY,
    value: next,
    updatedAt: new Date().toISOString()
  })

  await audit(
    'PRODUCT_CATEGORY_DELETED',
    'SETTINGS',
    'setting',
    CATEGORY_SETTING_KEY,
    { categories: current },
    { categories: next, removed: found },
    actor
  )

  return next
}

export async function updateProductCategory(oldName: string, newName: string, actor: User) {
  const oldClean = oldName.trim().replace(/\s+/g, ' ')
  const cleanName = newName.trim().replace(/\s+/g, ' ')

  if (cleanName.length < 2) throw new Error('La categoría debe tener al menos 2 caracteres.')
  if (cleanName.length > 40) throw new Error('La categoría no puede superar 40 caracteres.')
  if (cleanName.toLowerCase() === 'todos') {
    throw new Error('Ese nombre está reservado para el filtro general del punto de venta.')
  }

  const current = await getProductCategories()
  const found = current.find(item => item.toLowerCase() === oldClean.toLowerCase())

  if (!found) throw new Error('No encontramos esa categoría.')
  if (found === cleanName) return current

  if (current.some(item => item.toLowerCase() === cleanName.toLowerCase() && item !== found)) {
    throw new Error('Ya existe una categoría con ese nombre.')
  }

  const next = current.map(item => item === found ? cleanName : item)
  const products = await db.products.toArray()
  let updatedProducts = 0

  for (const product of products) {
    if (product.category.toLowerCase() === found.toLowerCase()) {
      await persistPut(db.products, 'products', {
        ...product,
        category: cleanName,
        updatedAt: new Date().toISOString()
      })
      updatedProducts += 1
    }
  }

  const now = new Date().toISOString()

  await persistPut(db.settings, 'settings', {
    id: CATEGORY_SETTING_KEY,
    key: CATEGORY_SETTING_KEY,
    value: next,
    updatedAt: now
  })

  await audit(
    'PRODUCT_CATEGORY_UPDATED',
    'SETTINGS',
    'setting',
    CATEGORY_SETTING_KEY,
    { categories: current },
    {
      categories: next,
      renamedFrom: found,
      renamedTo: cleanName,
      updatedProducts
    },
    actor
  )

  return next
}

export async function getPaymentMethods(): Promise<PaymentMethodConfig[]> {
  const setting = await db.settings.get(PAYMENT_METHODS_SETTING_KEY)
  const value = setting?.value

  if (Array.isArray(value)) {
    const cleaned = value.map(item => {
      if (!item || typeof item !== 'object') return null

      const raw = item as Record<string, unknown>
      const id = String(raw.id || '').trim()
      const name = String(raw.name || '').trim()

      if (!id || !name) return null

      return {
        id,
        name,
        createdAt: String(raw.createdAt || new Date(0).toISOString()),
        updatedAt: String(raw.updatedAt || new Date().toISOString())
      }
    }).filter(Boolean) as PaymentMethodConfig[]

    if (cleaned.length) return cleaned
  }

  return DEFAULT_PAYMENT_METHODS.map(item => ({ ...item }))
}

export async function addPaymentMethod(name: string, actor: User) {
  const cleanName = name.trim().replace(/\s+/g, ' ')

  if (cleanName.length < 2) {
    throw new Error('El medio de pago debe tener al menos 2 caracteres.')
  }

  if (cleanName.length > 35) {
    throw new Error('El medio de pago no puede superar 35 caracteres.')
  }

  const current = await getPaymentMethods()

  if (current.some(item => item.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error('Ese medio de pago ya existe.')
  }

  const now = new Date().toISOString()

  const next = [
    ...current,
    {
      id: `custom-${crypto.randomUUID().slice(0, 12)}`,
      name: cleanName,
      createdAt: now,
      updatedAt: now
    }
  ]

  await persistPut(db.settings, 'settings', {
    id: PAYMENT_METHODS_SETTING_KEY,
    key: PAYMENT_METHODS_SETTING_KEY,
    value: next,
    updatedAt: now
  })

  await audit(
    'PAYMENT_METHOD_CREATED',
    'SETTINGS',
    'setting',
    PAYMENT_METHODS_SETTING_KEY,
    { paymentMethods: current },
    { paymentMethods: next, added: cleanName },
    actor
  )

  return next
}

export async function updatePaymentMethod(id: string, name: string, actor: User) {
  const cleanName = name.trim().replace(/\s+/g, ' ')

  if (cleanName.length < 2) {
    throw new Error('El medio de pago debe tener al menos 2 caracteres.')
  }

  const current = await getPaymentMethods()

  if (!current.some(item => item.id === id)) {
    throw new Error('No encontramos ese medio de pago.')
  }

  if (current.some(item => item.id !== id && item.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error('Ya existe otro medio de pago con ese nombre.')
  }

  const now = new Date().toISOString()

  const next = current.map(item =>
    item.id === id
      ? { ...item, name: cleanName, updatedAt: now }
      : item
  )

  await persistPut(db.settings, 'settings', {
    id: PAYMENT_METHODS_SETTING_KEY,
    key: PAYMENT_METHODS_SETTING_KEY,
    value: next,
    updatedAt: now
  })

  await audit(
    'PAYMENT_METHOD_UPDATED',
    'SETTINGS',
    'setting',
    PAYMENT_METHODS_SETTING_KEY,
    { paymentMethods: current },
    { paymentMethods: next, updated: id },
    actor
  )

  return next
}

export async function deletePaymentMethod(id: string, actor: User) {
  const current = await getPaymentMethods()

  if (!current.some(item => item.id === id)) return current
  if (current.length <= 1) {
    throw new Error('Debe existir al menos un medio de pago disponible.')
  }

  const removed = current.find(item => item.id === id)
  const next = current.filter(item => item.id !== id)
  const now = new Date().toISOString()

  await persistPut(db.settings, 'settings', {
    id: PAYMENT_METHODS_SETTING_KEY,
    key: PAYMENT_METHODS_SETTING_KEY,
    value: next,
    updatedAt: now
  })

  await audit(
    'PAYMENT_METHOD_DELETED',
    'SETTINGS',
    'setting',
    PAYMENT_METHODS_SETTING_KEY,
    { paymentMethods: current },
    { paymentMethods: next, removed },
    actor
  )

  return next
}

export async function saveProduct(product: Product) {
  const previous = await db.products.get(product.id)
  const nextProduct: Product = {
    ...product,
    updatedAt: new Date().toISOString()
  }

  await persistPut(db.products, 'products', nextProduct)
  await audit(
    previous ? 'PRODUCT_UPDATED' : 'PRODUCT_CREATED',
    'PRODUCTS',
    'product',
    product.id,
    previous,
    nextProduct
  )

  return nextProduct
}

export async function getSales() {
  const sales = await db.sales.orderBy('createdAt').reverse().toArray()
  return sales.filter(sale => !sale.deletedAt)
}

export async function addSale(sale: Sale) {
  const nextSale: Sale = {
    ...sale,
    updatedAt: new Date().toISOString()
  }

  await persistAdd(db.sales, 'sales', nextSale)
  await audit('INVOICE_CREATED', 'SALES', 'sale', nextSale.id, null, nextSale)

  return nextSale
}

const businessDayKey = (iso: string | Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(new Date(iso))

export { businessDayKey }

export const recordBusinessDayKey = (record: {
  createdAt: string
  businessDateKey?: string
}) => record.businessDateKey || businessDayKey(record.createdAt)

export async function getCurrentBusinessDayKey() {
  const calendarKey = businessDayKey(new Date())
  const closure = await db.closures.where('dateKey').equals(calendarKey).first()
  return closure && !closure.deletedAt ? closure.nextDateKey : calendarKey
}

export const addBusinessDay = (dateKey: string, amount = 1) => {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  date.setUTCDate(date.getUTCDate() + amount)

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

export async function getClosures() {
  const closures = await db.closures.orderBy('closedAt').reverse().toArray()
  return closures.filter(closure => !closure.deletedAt)
}


type SalesPurgeResult =
  | { ok: false; error: string }
  | { ok: true; pending: boolean; purgeBefore: string; sales: number; history: number; audit: number; backups: number; closures: number }

export async function purgeSalesData(actor: User, saleIds?: string[]): Promise<SalesPurgeResult> {
  const streamlinxActor = isStreamlinxOperator(actor)
  const freshActor = streamlinxActor ? actor : await db.users.get(actor.id)
  if (!freshActor?.active || (!streamlinxActor && !hasPermission(freshActor, 'sales.delete'))) {
    return { ok: false, error: 'El usuario actual no tiene autorización para administrar ventas desde StreamLinx.' }
  }

  const normalizedIds = Array.from(new Set((saleIds || []).map(String).filter(Boolean)))
  const purgeBefore = new Date().toISOString()
  let remotePending = false

  if (navigator.onLine) {
    // StreamLinx purge is independent from the normal POS/Supabase session.
    const remote = await purgeRemoteSales(purgeBefore, normalizedIds)
    if (!remote.ok && !remote.offline) {
      return { ok: false, error: remote.error || 'No fue posible purgar las ventas en Supabase.' }
    }
    remotePending = !remote.ok && remote.offline
  } else {
    remotePending = true
  }

  const local = await applyLocalSalesPurge(purgeBefore, true, normalizedIds)
  if (remotePending) {
    await enqueueSalesPurgeOperation(actor.id, purgeBefore, normalizedIds)
  }

  await audit(
    normalizedIds.length ? 'SYSTEM_SALE_PURGE_EXECUTED' : 'SYSTEM_SALES_PURGE_EXECUTED',
    'SYSTEM',
    'sales-purge',
    'sales-purge',
    null,
    {
      purgeBefore,
      purgedCount: local.sales,
      remote: remotePending ? 'pending' : 'completed',
    },
    freshActor,
    normalizedIds.length === 1
      ? 'Venta eliminada definitivamente desde StreamLinx Command Center.'
      : normalizedIds.length > 1
        ? `Se eliminaron ${local.sales} ventas definitivamente desde StreamLinx Command Center.`
        : `Todas las ventas (${local.sales}) fueron eliminadas definitivamente desde StreamLinx Command Center.`
  )

  return { ok: true, pending: remotePending, purgeBefore, ...local }
}

export async function resetTestData(actor: User) {
  const freshActor = await db.users.get(actor.id)
  if (!freshActor?.active || freshActor.role !== 'manager') return false

  if (navigator.onLine) await ensureRemoteSession()

  const remote = await resetRemoteData()
  if (!remote.ok && (!('offline' in remote) || !remote.offline)) return false

  const now = new Date().toISOString()
  let counts = {
    sales: 0,
    orders: 0,
    closures: 0
  }

  await db.transaction('rw', [db.sales, db.orders, db.closures, db.syncQueue], async () => {
    const [sales, orders, closures] = await Promise.all([
      db.sales.toArray(),
      db.orders.toArray(),
      db.closures.toArray()
    ])

    const liveSales = sales.filter(item => !item.deletedAt)
    const liveOrders = orders.filter(item => !item.deletedAt)
    const liveClosures = closures.filter(item => !item.deletedAt)

    counts = {
      sales: liveSales.length,
      orders: liveOrders.length,
      closures: liveClosures.length
    }

    await Promise.all(
      liveSales.map(item =>
        db.sales.put({
          ...item,
          deletedAt: now,
          deletedBy: actor.id,
          updatedAt: now
        })
      )
    )

    await Promise.all(
      liveOrders.map(item =>
        db.orders.put({
          ...item,
          deletedAt: now,
          deletedBy: actor.id,
          updatedAt: now
        })
      )
    )

    await Promise.all(
      liveClosures.map(item =>
        db.closures.put({
          ...item,
          deletedAt: now,
          deletedBy: actor.id,
          updatedAt: now
        })
      )
    )

    // If the server was unavailable, one single ordered reset command is enough
    // to reproduce the same operation remotely. We intentionally do not enqueue
    // every individual tombstone as well, which would create duplicate work.
    if ('offline' in remote && remote.offline) {
      await enqueueResetOperation(actor.id)
    }
  })

  await audit(
    'SYSTEM_RESET_EXECUTED',
    'SYSTEM',
    'reset',
    'operational-data',
    counts,
    {
      deletedAt: now,
      remote: remote.ok ? 'completed' : 'pending'
    },
    actor
  )

  return true
}

export async function getClosureByDate(dateKey: string) {
  const closure = await db.closures.where('dateKey').equals(dateKey).first()
  return closure?.deletedAt ? undefined : closure
}

export async function deletePreviousDayClosure(closureId: string, actor: User) {
  const freshActor = await db.users.get(actor.id)

  if (!freshActor?.active || freshActor.role !== 'manager') {
    return false
  }

  const yesterdayKey = addBusinessDay(businessDayKey(new Date()), -1)
  const closure = await db.closures.get(closureId)

  if (!closure || closure.dateKey !== yesterdayKey) return false

  const after = {
    ...closure,
    deletedAt: new Date().toISOString(),
    deletedBy: actor.id,
    updatedAt: new Date().toISOString()
  }

  await persistPut(db.closures, 'cash_closures', after)
  await audit(
    'CASH_CLOSE_DELETED',
    'CASH',
    'closure',
    closureId,
    closure,
    after,
    actor
  )

  return true
}

export async function createDailyClosure(
  dateKey: string,
  actor: User,
  cashCounted: number,
  notes = ''
): Promise<CashClosure | null> {
  const freshActor = await db.users.get(actor.id)

  if (!freshActor?.active || !hasPermission(freshActor, 'cashClosing.access')) {
    return null
  }

  const existingClosure = await db.closures.where('dateKey').equals(dateKey).first()

  if (existingClosure && !existingClosure.deletedAt) {
    throw new Error('Este día ya tiene un cierre registrado.')
  }

  const sales = (await db.sales.toArray())
    .filter(sale => recordBusinessDayKey(sale) === dateKey)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const methods = await getPaymentMethods()

  const labels = Object.fromEntries(
    (Array.isArray(methods) ? methods : []).map(item => [item.id, item.name])
  ) as Record<string, string>

  const payments = sales.reduce<Record<string, number>>((acc, sale) => {
    acc[sale.payment] = (acc[sale.payment] || 0) + sale.total
    return acc
  }, {})

  const totals = sales.reduce((acc, sale) => {
    acc.total += sale.total
    if (sale.payment === 'cash') acc.cash += sale.total
    else if (sale.payment === 'transfer') acc.transfer += sale.total
    else if (sale.payment === 'card') acc.card += sale.total
    return acc
  }, {
    total: 0,
    cash: 0,
    transfer: 0,
    card: 0
  })

  const counted = Number.isFinite(cashCounted)
    ? Math.max(0, cashCounted)
    : 0

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
    payments,
    paymentLabels: labels,
    cashExpected: totals.cash,
    cashCounted: counted,
    cashDifference: counted - totals.cash,
    notes: notes.trim(),
    sales: sales.map(sale => ({
      ...sale,
      items: Array.isArray(sale.items)
        ? sale.items.map(item => ({ ...item }))
        : []
    })),
    nextDateKey: addBusinessDay(dateKey, 1)
  }

  await persistAdd(db.closures, 'cash_closures', closure)

  await audit(
    'CASH_CLOSE_CREATED',
    'CASH',
    'closure',
    closure.id,
    null,
    closure,
    freshActor
  )

  return closure
}

const normalizePhone = (value: string) => value.replace(/\D/g, '')

export async function getCustomers() {
  const customers = await db.customers.toArray()
  return customers
    .filter(customer => customer.active)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export async function findCustomerByPhone(phone: string) {
  const normalized = normalizePhone(phone)
  if (!normalized) return null

  const customer = await db.customers.where('phone').equals(normalized).first()

  return customer && customer.active ? customer : null
}

export async function createCustomer(
  input: Pick<Customer, 'name' | 'phone' | 'address' | 'notes'> & {
    customFields?: Record<string, string>
  },
  actor: User
) {
  const name = input.name.trim().replace(/\s+/g, ' ')
  const phone = normalizePhone(input.phone)
  const address = input.address.trim()
  const notes = input.notes.trim()

  if (name.length < 2) throw new Error('Escribe el nombre del cliente.')
  if (phone.length < 7 || phone.length > 15) throw new Error('Escribe un celular válido.')

  const duplicate = await findCustomerByPhone(phone)

  if (duplicate) {
    throw new Error(`Ya existe un cliente con el celular ${duplicate.phone}.`)
  }

  const now = new Date().toISOString()

  const customFields = Object.fromEntries(
    Object.entries(input.customFields || {})
      .map(([key, value]) => [key, String(value ?? '').trim()])
      .filter(([, value]) => value)
  )

  const customer: Customer = {
    id: crypto.randomUUID(),
    name,
    phone,
    address,
    notes,
    customFields,
    createdAt: now,
    updatedAt: now,
    active: true
  }

  await persistAdd(db.customers, 'customers', customer)

  await audit(
    'CUSTOMER_CREATED',
    'CUSTOMERS',
    'customer',
    customer.id,
    null,
    customer,
    actor
  )

  return customer
}

export async function updateCustomer(
  id: string,
  input: Pick<Customer, 'name' | 'phone' | 'address' | 'notes'> & {
    customFields?: Record<string, string>
  },
  actor: User
) {
  const current = await db.customers.get(id)

  if (!current) return null

  const name = input.name.trim().replace(/\s+/g, ' ')
  const phone = normalizePhone(input.phone)
  const address = input.address.trim()
  const notes = input.notes.trim()

  if (name.length < 2) throw new Error('Escribe el nombre del cliente.')
  if (phone.length < 7 || phone.length > 15) throw new Error('Escribe un celular válido.')

  const duplicate = await db.customers.where('phone').equals(phone).first()

  if (duplicate && duplicate.id !== id && duplicate.active) {
    throw new Error(`Ya existe un cliente con el celular ${phone}.`)
  }

  const customFields = Object.fromEntries(
    Object.entries(input.customFields || {})
      .map(([key, value]) => [key, String(value ?? '').trim()])
      .filter(([, value]) => value)
  )

  const after: Customer = {
    ...current,
    name,
    phone,
    address,
    notes,
    customFields,
    updatedAt: new Date().toISOString()
  }

  await persistPut(db.customers, 'customers', after)

  await audit(
    'CUSTOMER_UPDATED',
    'CUSTOMERS',
    'customer',
    id,
    current,
    after,
    actor
  )

  return after
}

export async function deactivateCustomer(id: string, actor: User) {
  const current = await db.customers.get(id)

  if (!current) return false

  const after = {
    ...current,
    active: false,
    updatedAt: new Date().toISOString()
  }

  await persistPut(db.customers, 'customers', after)

  await audit(
    'CUSTOMER_DEACTIVATED',
    'CUSTOMERS',
    'customer',
    id,
    current,
    after,
    actor
  )

  return true
}

export async function getOrders() {
  const orders = await db.orders.orderBy('createdAt').reverse().toArray()
  return orders.filter(order => !order.deletedAt)
}

export async function createOrder(
  items: Order['items'],
  delivery: DeliveryInfo,
  user: User,
  customerId?: string
) {
  const configuredFields = await getOrderFields()

  if (customerId) {
    const missing = configuredFields
      .filter(field => field.enabled && field.required)
      .find(field => {
        const value = field.system
          ? ({
              name: delivery.customerName,
              phone: delivery.phone,
              address: delivery.address,
              notes: delivery.notes
            } as Record<string, string | undefined>)[field.id]
          : delivery.customFields?.[field.id]

        return !String(value || '').trim()
      })

    if (missing) {
      throw new Error(`Completa el campo “${missing.label}” antes de guardar el pedido.`)
    }
  }

  const now = new Date()
  const calendarKey = businessDayKey(now)
  const closure = await db.closures.where('dateKey').equals(calendarKey).first()
  const businessDateKey = closure && !closure.deletedAt
    ? closure.nextDateKey
    : calendarKey

  const existing = await db.orders.toArray()
  const todayOrders = existing.filter(
    order => recordBusinessDayKey(order) === businessDateKey
  )

  const nextNumber =
    todayOrders.reduce(
      (max, order) => Math.max(max, Number(order.orderNumber) || 0),
      0
    ) + 1

  const cleanItems = items.map(item => ({
    ...item,
    modification: item.modification?.trim() || undefined
  }))

  const total = cleanItems.reduce((sum, item) => sum + item.total, 0)

  const order: Order = {
    id: crypto.randomUUID(),
    orderNumber: nextNumber,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    userId: user.id,
    userName: user.name,
    customerId: customerId || undefined,
    customerName: delivery.customerName || '',
    phone: delivery.phone || '',
    address: delivery.address || '',
    notes: delivery.notes || '',
    customFields: Object.fromEntries(
      Object.entries(delivery.customFields || {})
        .map(([key, value]) => [key, String(value ?? '').trim()])
        .filter(([, value]) => value)
    ),
    customFieldLabels: {
      ...(delivery.customFieldLabels || {})
    },
    items: cleanItems,
    subtotal: total,
    total,
    status: 'pending',
    businessDateKey
  }

  await persistAdd(db.orders, 'orders', order)

  await audit(
    'ORDER_CREATED',
    'ORDERS',
    'order',
    order.id,
    null,
    order,
    user
  )

  return order
}

export async function updateOrderItems(
  orderId: string,
  items: Order['items'],
  notes?: string
) {
  const order = await db.orders.get(orderId)

  if (!order || ['paid', 'cancelled'].includes(order.status) || !items.length) {
    return order ?? null
  }

  const cleanItems = items.map(item => ({
    ...item,
    modification: item.modification?.trim() || undefined
  }))

  const subtotal = cleanItems.reduce((sum, item) => sum + item.total, 0)

  const after = {
    ...order,
    items: cleanItems,
    subtotal,
    total: subtotal,
    ...(notes !== undefined ? { notes: notes.trim() } : {}),
    updatedAt: new Date().toISOString()
  }

  await persistPut(db.orders, 'orders', after)

  await audit(
    'ORDER_UPDATED',
    'ORDERS',
    'order',
    orderId,
    order,
    after
  )

  return after
}

export async function getSaleForOrder(orderId: string) {
  return db.sales.where('orderId').equals(orderId).first()
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus
) {
  const order = await db.orders.get(orderId)

  if (!order || ['paid', 'cancelled'].includes(order.status)) {
    return order ?? null
  }

  const after = {
    ...order,
    status,
    updatedAt: new Date().toISOString()
  }

  await persistPut(db.orders, 'orders', after)

  await audit(
    'ORDER_UPDATED',
    'ORDERS',
    'order',
    orderId,
    order,
    after
  )

  return after
}

export async function updateOrderComandaStatus(
  orderId: string,
  status: 'printed' | 'skipped'
) {
  const order = await db.orders.get(orderId)

  if (!order || ['paid', 'cancelled'].includes(order.status)) {
    return order ?? null
  }

  const now = new Date().toISOString()

  const after: Order = {
    ...order,
    comandaStatus: status,
    ...(status === 'printed'
      ? {
          comandaPrintedAt: now,
          comandaSkippedAt: undefined
        }
      : {
          comandaSkippedAt: now
        }),
    updatedAt: now,
  }

  await persistPut(db.orders, 'orders', after)

  await audit(
    status === 'printed'
      ? 'ORDER_TICKET_PRINTED'
      : 'ORDER_TICKET_SKIPPED',
    'ORDERS',
    'order',
    orderId,
    order,
    after
  )

  return after
}

async function resolveLocalActor(actor: User): Promise<User | null> {
  // Después de la migración a Supabase el id de sesión puede ser un UUID remoto
  // mientras que una instalación anterior conserva el perfil local con legacyId.
  // Resolver ambas claves evita que el cobro falle simplemente porque la caché
  // todavía no ha reconciliado el cambio de identidad.
  const byId = await db.users.get(actor.id)

  if (byId) return byId

  if (actor.legacyId) {
    const byLegacy = await db.users
      .where('legacyId')
      .equals(actor.legacyId)
      .first()

    if (byLegacy) return byLegacy
  }

  const localByEmail = actor.authEmail
    ? (await db.users.toArray()).find(
        user => user.authEmail === actor.authEmail
      )
    : undefined

  if (localByEmail) return localByEmail

  // El usuario de sesión sigue siendo una credencial válida aunque su copia
  // local no exista todavía. Para el flujo offline/online esto es preferible
  // a rechazar una venta que sí puede quedar protegida en la outbox.
  if (!actor.active) return null

  await db.users.put(actor)

  return actor
}

export async function completeOrder(
  orderId: string,
  payment: PaymentMethod,
  actor: User,
  discount?: { type: 'percent' | 'fixed'; value: number },
  paymentLabel?: string
) {
  // El cobro no mantiene una transacción Dexie abierta mientras ejecuta
  // sincronización/auditoría. Cada escritura de negocio usa su propia outbox,
  // evitando "Transaction committed too early" en IndexedDB.
  const order = await db.orders.get(orderId)

  if (!order) {
    throw new Error('No encontramos el pedido que intentas cobrar. Actualiza el pedido e inténtalo de nuevo.')
  }

  if (['paid', 'cancelled'].includes(order.status)) {
    throw new Error('Este pedido ya fue cobrado o está cancelado.')
  }

  const freshActor = await resolveLocalActor(actor)

  if (!freshActor?.active) {
    throw new Error('La sesión del trabajador no está disponible. Cierra sesión y vuelve a ingresar.')
  }

  if (!hasPermission(freshActor, 'pos.access')) {
    throw new Error('Este usuario no tiene permiso para registrar ventas.')
  }

  const businessDateKey = recordBusinessDayKey(order)
  const existingClosure = await db.closures
    .where('dateKey')
    .equals(businessDateKey)
    .first()

  if (existingClosure && !existingClosure.deletedAt) {
    throw new Error(
      `El periodo del ${businessDateKey.split('-').reverse().join('/')} ya fue cerrado. Registra el pedido en el siguiente periodo.`
    )
  }

  const subtotal = Math.max(0, Number(order.subtotal) || 0)

  const safeDiscountValue = discount?.type === 'percent'
    ? Math.min(100, Math.max(0, Number(discount.value) || 0))
    : Math.min(
        subtotal,
        Math.max(0, Number(discount?.value) || 0)
      )

  const discountAmount =
    discount?.type === 'percent'
      ? Math.round(subtotal * safeDiscountValue / 100)
      : Math.round(safeDiscountValue)

  const saleTotal = Math.max(
    0,
    subtotal - discountAmount
  )

  const sale: Sale = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    userId: freshActor.id,
    userName: freshActor.name,
    customerId: order.customerId,
    payment,
    paymentLabel:
      paymentLabel ||
      (
        payment === 'cash'
          ? 'Efectivo'
          : payment === 'transfer'
            ? 'Transferencia'
            : payment === 'card'
              ? 'Tarjeta'
              : payment
      ),
    orderId: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    phone: order.phone,
    address: order.address,
    notes: order.notes,
    customFields: {
      ...(order.customFields || {})
    },
    customFieldLabels: {
      ...(order.customFieldLabels || {})
    },
    items: Array.isArray(order.items)
      ? order.items.map(item => ({ ...item }))
      : [],
    subtotal,
    total: saleTotal,
    discountType:
      discount && safeDiscountValue > 0
        ? discount.type
        : undefined,
    discountValue:
      discount && safeDiscountValue > 0
        ? safeDiscountValue
        : undefined,
    discountAmount:
      discountAmount > 0
        ? discountAmount
        : undefined,
    businessDateKey,
    updatedAt: new Date().toISOString()
  }

  await persistAdd(db.sales, 'sales', sale)

  const updatedOrder = {
    ...order,
    status: 'paid' as const,
    updatedAt: new Date().toISOString()
  }

  await persistPut(db.orders, 'orders', updatedOrder)

  await audit(
    'INVOICE_CREATED',
    'SALES',
    'sale',
    sale.id,
    null,
    sale,
    freshActor
  )

  await audit(
    'ORDER_UPDATED',
    'ORDERS',
    'order',
    order.id,
    order,
    updatedOrder,
    freshActor
  )

  return {
    sale,
    order: updatedOrder as Order
  }
}

export async function deleteSale(
  targetId: string,
  actorId: string
) {
  const actor = await db.users.get(actorId)

  if (!actor || !actor.active || !hasPermission(actor, 'sales.delete')) {
    return false
  }

  const sale = await db.sales.get(targetId)

  if (!sale) return false

  const after = {
    ...sale,
    deletedAt: new Date().toISOString(),
    deletedBy: actor.id,
    updatedAt: new Date().toISOString()
  }

  await persistPut(db.sales, 'sales', after)

  await audit(
    'INVOICE_DELETED',
    'SALES',
    'sale',
    targetId,
    sale,
    after,
    actor
  )

  return true
}

export async function deleteProduct(
  targetId: string,
  actorId: string
) {
  const actor = await db.users.get(actorId)

  if (!actor || !actor.active || !hasPermission(actor, 'products.manage')) {
    return false
  }

  const product = await db.products.get(targetId)

  if (!product) return false

  const after = {
    ...product,
    deletedAt: new Date().toISOString(),
    deletedBy: actor.id,
    updatedAt: new Date().toISOString()
  }

  await persistPut(db.products, 'products', after)

  await audit(
    'PRODUCT_DELETED',
    'PRODUCTS',
    'product',
    targetId,
    product,
    after,
    actor
  )

  return true
}

export async function deleteOrder(
  targetId: string,
  actorId: string
) {
  const actor = await db.users.get(actorId)

  if (!actor || !actor.active || actor.role !== 'manager') {
    return false
  }

  const order = await db.orders.get(targetId)

  if (!order || order.status === 'paid') {
    return false
  }

  const after = {
    ...order,
    deletedAt: new Date().toISOString(),
    deletedBy: actor.id,
    updatedAt: new Date().toISOString()
  }

  await persistPut(db.orders, 'orders', after)

  await audit(
    'ORDER_DELETED',
    'ORDERS',
    'order',
    targetId,
    order,
    after,
    actor
  )

  return true
}

export async function replaceProducts(products: Product[]) {
  await db.transaction(
    'rw',
    [db.products, db.syncQueue],
    async () => {
      await db.products.clear()

      for (const product of products) {
        await db.products.add(product)
        await enqueueEntityUpsert(
          'products',
          product.id,
          product
        )
      }
    }
  )
}

export async function getUsers() {
  const roleOrder: Record<Role, number> = {
    manager: 0,
    admin: 1,
    employee: 2,
  }

  if (navigator.onLine) {
    try {
      const remoteProfiles = await getLoginProfiles(false)

      if (remoteProfiles.length) {
        return remoteProfiles
          .map(profile => ({
            id: profile.id,
            legacyId: profile.legacyId,
            authEmail: profile.authEmail,
            name: profile.name,
            role: profile.role,
            rank: profile.rank,
            active: profile.active,
            pin: '',
            permissions: defaultPermissionsForRole(profile.role),
            updatedAt: new Date().toISOString(),
          } as User))
          .sort(
            (a, b) =>
              roleOrder[a.role] - roleOrder[b.role] ||
              a.name.localeCompare(b.name, 'es')
          )
      }
    } catch (error) {
      console.warn(
        'Smaky: no fue posible cargar usuarios remotos; usando caché local.',
        error
      )
    }
  }

  const users = await db.users.toArray()

  return users
    .filter(user => !user.deletedAt)
    .sort((a, b) => {
      const roleOrder: Record<Role, number> = {
        manager: 0,
        admin: 1,
        employee: 2,
      }

      return (
        roleOrder[a.role] - roleOrder[b.role] ||
        a.name.localeCompare(b.name, 'es')
      )
    })
}

export async function createWorker(
  name: string,
  pin: string,
  rank: string
) {
  const legacyId = crypto.randomUUID()

  let remote:
    | Awaited<ReturnType<typeof createRemoteWorker>>
    | null = null

  if (navigator.onLine) {
    try {
      await ensureRemoteSession()

      remote = await createRemoteWorker(
        name.trim(),
        pin,
        rank.trim(),
        legacyId
      )
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }

  const user: User = {
    id: remote?.id || legacyId,
    legacyId: remote?.legacyId || legacyId,
    authEmail:
      remote?.authEmail ||
      `${legacyId}@smaky.local`,
    name: remote?.name || name.trim(),
    role: remote?.role || 'employee',
    pin,
    rank: remote?.rank || rank.trim(),
    active: remote?.active ?? true,
    permissions:
      remote?.permissions ||
      [
        'dashboard.view',
        'pos.access',
        'customers.manage',
        'sales.view',
        'cashClosing.access'
      ],
    updatedAt: new Date().toISOString()
  }

  await withSyncSuppressed(() => db.users.put(user))

  if (!remote) {
    await enqueueUserProvision(user)
  }

  await audit(
    'USER_CREATED',
    'USERS',
    'user',
    user.id,
    null,
    { ...user, pin: undefined }
  )

  return user
}

export type UserSettings = Pick<
  User,
  'name' |
  'pin' |
  'rank' |
  'active' |
  'role' |
  'permissions'
>

export async function updateUserSettings(
  targetId: string,
  changes: Partial<UserSettings>,
  actorId: string
) {
  const actor =
    getSessionUser() ||
    await db.users.get(actorId)

  const localTarget = await db.users.get(targetId)

  const remoteTarget =
    actor?.role === 'manager' && navigator.onLine
      ? await getManagedProfile(targetId)
      : null

  const remoteBasicTarget =
    !remoteTarget && navigator.onLine
      ? (await getLoginProfiles(false))
          .find(profile => profile.id === targetId) ||
        null
      : null

  const target: User | null = remoteTarget
    ? {
        id: remoteTarget.id,
        legacyId: remoteTarget.legacyId,
        authEmail: remoteTarget.authEmail,
        name: remoteTarget.name,
        role: remoteTarget.role,
        rank: remoteTarget.rank,
        active: remoteTarget.active,
        pin: remoteTarget.pin,
        permissions:
          remoteTarget.permissions ||
          defaultPermissionsForRole(remoteTarget.role),
        updatedAt: new Date().toISOString(),
      }
    : remoteBasicTarget
      ? {
          id: remoteBasicTarget.id,
          legacyId: remoteBasicTarget.legacyId,
          authEmail: remoteBasicTarget.authEmail,
          name: remoteBasicTarget.name,
          role: remoteBasicTarget.role,
          rank: remoteBasicTarget.rank,
          active: remoteBasicTarget.active,
          pin: '',
          permissions:
            defaultPermissionsForRole(
              remoteBasicTarget.role
            ),
          updatedAt: new Date().toISOString(),
        }
      : localTarget ?? null

  if (!actor || !target || !actor.active) {
    return target
  }

  const safeChanges: Partial<UserSettings> = {}

  if (
    typeof changes.name === 'string' &&
    changes.name.trim().length >= 2
  ) {
    safeChanges.name = changes.name.trim()
  }

  if (
    typeof changes.pin === 'string' &&
    /^\d{4}$/.test(changes.pin)
  ) {
    safeChanges.pin = changes.pin
  }

  if (
    typeof changes.rank === 'string' &&
    changes.rank.trim().length >= 2
  ) {
    safeChanges.rank = changes.rank.trim()
  }

  if (
    actor.role === 'manager' &&
    Array.isArray(changes.permissions)
  ) {
    safeChanges.permissions =
      Array.from(
        new Set([
          ...changes.permissions.filter(
            (
              key
            ): key is PermissionKey =>
              [
                'dashboard.view',
                'pos.access',
                'customers.manage',
                'customers.export',
                'sales.view',
                'sales.delete',
                'products.manage',
                'reports.view',
                'cashClosing.access'
              ].includes(key)
          ),
          'pos.access'
        ])
      ) as PermissionKey[]
  }

  const wantsRoleChange =
    changes.role !== undefined &&
    changes.role !== target.role

  const wantsActiveChange =
    changes.active !== undefined &&
    changes.active !== target.active

  const actorIsManager =
    actor.role === 'manager'

  if (target.role === 'manager') {
    if (target.id !== actor.id) return target
    if (wantsRoleChange || wantsActiveChange) return target
  }

  if (wantsRoleChange && !actorIsManager) return target

  if (
    wantsRoleChange &&
    !['admin', 'employee'].includes(
      changes.role as string
    )
  ) {
    return target
  }

  if (
    target.role === 'admin' &&
    changes.role === 'employee' &&
    !actorIsManager
  ) {
    return target
  }

  if (
    target.id === actor.id &&
    wantsActiveChange
  ) {
    return target
  }

  if (
    wantsActiveChange &&
    target.role === 'admin' &&
    !actorIsManager
  ) {
    return target
  }

  if (
    wantsActiveChange &&
    target.role === 'manager'
  ) {
    return target
  }

  if (wantsRoleChange) {
    safeChanges.role = changes.role
  }

  if (wantsActiveChange) {
    safeChanges.active = changes.active
  }

  if (!Object.keys(safeChanges).length) {
    return target
  }

  const after: User = {
    ...target,
    ...safeChanges,
    updatedAt: new Date().toISOString()
  }

  let remote:
    | Awaited<ReturnType<typeof updateRemoteUser>>
    | null = null

  if (navigator.onLine) {
    try {
      await ensureRemoteSession()
      remote = await updateRemoteUser(
        targetId,
        safeChanges
      )
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }

  if (remote) {
    Object.assign(after, {
      id: remote.id,
      authEmail: remote.authEmail,
      legacyId:
        remote.legacyId ||
        after.legacyId,
      name: remote.name,
      role: remote.role,
      rank: remote.rank,
      active: remote.active,
      permissions: remote.permissions,
      updatedAt: new Date().toISOString()
    })
  }

  await withSyncSuppressed(
    () => db.users.put(after)
  )

  if (!remote) {
    await enqueueUserUpdate(
      targetId,
      safeChanges
    )
  }

  await audit(
    wantsActiveChange &&
      changes.active === false
      ? 'USER_DISABLED'
      : 'USER_UPDATED',
    'USERS',
    'user',
    targetId,
    { ...target, pin: undefined },
    { ...after, pin: undefined },
    actor
  )

  return (await db.users.get(targetId)) ?? null
}

export async function deleteUserProfile(
  targetId: string,
  actorId: string
) {
  const actor =
    getSessionUser() ||
    await db.users.get(actorId)

  const localTarget =
    await db.users.get(targetId)

  if (
    !actor ||
    !actor.active ||
    actor.role !== 'manager'
  ) {
    return false
  }

  if (targetId === actor.id) {
    return false
  }

  let remoteDeleted = false

  if (navigator.onLine) {
    try {
      await ensureRemoteSession()
      remoteDeleted =
        await deleteRemoteUser(targetId)
    } catch (error) {
      if (!isNetworkError(error)) throw error
    }
  }

  if (remoteDeleted) {
    if (localTarget) {
      const after = {
        ...localTarget,
        deletedAt: new Date().toISOString(),
        deletedBy: actor.id,
        active: false,
        updatedAt: new Date().toISOString()
      }

      await withSyncSuppressed(
        () => db.users.put(after)
      )
    }

    await audit(
      'USER_DELETED',
      'USERS',
      'user',
      targetId,
      localTarget
        ? {
            ...localTarget,
            pin: undefined
          }
        : null,
      localTarget
        ? {
            ...localTarget,
            pin: undefined,
            active: false
          }
        : {
            id: targetId,
            active: false
          },
      actor
    )

    return true
  }

  if (!localTarget) return false

  const after = {
    ...localTarget,
    deletedAt: new Date().toISOString(),
    deletedBy: actor.id,
    active: false,
    updatedAt: new Date().toISOString()
  }

  await withSyncSuppressed(
    () => db.users.put(after)
  )

  if (!remoteDeleted) {
    await enqueueUserDelete(targetId)
  }

  await audit(
    'USER_DELETED',
    'USERS',
    'user',
    targetId,
    {
      ...localTarget,
      pin: undefined
    },
    {
      ...after,
      pin: undefined
    },
    actor
  )

  return true
}