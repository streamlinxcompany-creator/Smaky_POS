import { db, setDbMutationListener, setDbSyncApplying } from './db'
import { supabase, supabaseConfigured } from './supabase'
import type { AuditEvent, CashClosure, Customer, HistoryRecord, Order, Product, Sale, SystemSetting, User } from './types'

let syncTimer: number | null = null
let periodicTimer: number | null = null
let syncing = false
let started = false

const delay = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function timestampOf(value: unknown): number {
  const row = asObject(value)
  const candidates = [row.updatedAt, row.deletedAt, row.createdAt, row.closedAt, row.timestamp, row.capturedAt]
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const time = Date.parse(candidate)
      if (Number.isFinite(time)) return time
    }
  }
  return 0
}

function rowTimestamp(value: Record<string, unknown>): number {
  const time = Date.parse(String(value.updated_at || value.deleted_at || value.created_at || value.closed_at || value.timestamp || value.captured_at || ''))
  return Number.isFinite(time) ? time : 0
}

function remoteRecord(id: string, data: Record<string, unknown>, deletedAt?: string) {
  const updatedAt = String(data.updatedAt || data.deletedAt || data.createdAt || data.closedAt || data.timestamp || data.capturedAt || '1970-01-01T00:00:00.000Z')
  return { id, updated_at: updatedAt, deleted_at: deletedAt || null, data }
}

async function syncJsonTable<T extends { id: string }>(
  table: string,
  readLocal: () => Promise<T[]>,
  putLocal: (row: T) => Promise<void>,
  mapRemoteToLocal: (row: Record<string, unknown>) => T | null,
  mapLocalToRemote: (row: T) => Record<string, unknown>,
) {
  if (!supabase) return
  const { data: remoteRows, error } = await supabase.from(table).select('*').limit(5000)
  if (error) throw error

  const localRows = await readLocal()
  const remoteMap = new Map<string, Record<string, unknown>>()
  for (const row of (remoteRows || []) as Record<string, unknown>[]) {
    const id = String(row.id || '')
    if (id) remoteMap.set(id, row)
  }

  const pendingRemote: Record<string, unknown>[] = []
  const localMap = new Map(localRows.map(row => [row.id, row]))

  for (const local of localRows) {
    const remote = remoteMap.get(local.id)
    if (!remote) {
      pendingRemote.push(mapLocalToRemote(local))
      continue
    }
    if (timestampOf(local) > rowTimestamp(remote)) {
      pendingRemote.push(mapLocalToRemote(local))
    } else if (timestampOf(local) < rowTimestamp(remote)) {
      const converted = mapRemoteToLocal(remote)
      if (converted) await putLocal(converted)
    }
  }

  for (const remote of remoteMap.values()) {
    const id = String(remote.id || '')
    if (id && !localMap.has(id)) {
      const converted = mapRemoteToLocal(remote)
      if (converted) await putLocal(converted)
    }
  }

  if (pendingRemote.length) {
    const { error: upsertError } = await supabase.from(table).upsert(pendingRemote, { onConflict: 'id' })
    if (upsertError) throw upsertError
  }
}

function productRemote(row: Product) {
  const updatedAt = row.updatedAt || row.deletedAt || new Date().toISOString()
  const data = { ...row, updatedAt }
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: row.price,
    active: row.active,
    deleted_at: row.deletedAt || null,
    deleted_by: row.deletedBy || null,
    updated_at: updatedAt,
    data,
  }
}

function customerRemote(row: Customer) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    active: row.active,
    custom_fields: row.customFields || {},
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    data: row,
  }
}

function orderRemote(row: Order) {
  return {
    id: row.id,
    order_number: row.orderNumber,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    user_id: row.userId || null,
    customer_id: row.customerId || null,
    status: row.status,
    business_date_key: row.businessDateKey || null,
    total: row.total,
    deleted_at: row.deletedAt || null,
    deleted_by: row.deletedBy || null,
    data: row,
  }
}

function saleRemote(row: Sale) {
  const updatedAt = row.updatedAt || row.deletedAt || row.createdAt
  const data = { ...row, updatedAt }
  return {
    id: row.id,
    created_at: row.createdAt,
    updated_at: updatedAt,
    user_id: row.userId || null,
    customer_id: row.customerId || null,
    payment: row.payment,
    order_id: row.orderId || null,
    order_number: row.orderNumber ?? null,
    business_date_key: row.businessDateKey || null,
    total: row.total,
    deleted_at: row.deletedAt || null,
    deleted_by: row.deletedBy || null,
    data,
  }
}

function closureRemote(row: CashClosure) {
  const updatedAt = row.updatedAt || row.deletedAt || row.closedAt
  const data = { ...row, updatedAt }
  return {
    id: row.id,
    date_key: row.dateKey,
    closed_at: row.closedAt,
    user_id: row.userId || null,
    total: row.total,
    deleted_at: row.deletedAt || null,
    deleted_by: row.deletedBy || null,
    updated_at: updatedAt,
    data,
  }
}

function settingRemote(row: SystemSetting) {
  return { id: row.id, key: row.key, updated_at: row.updatedAt, data: row }
}

function auditRemote(row: AuditEvent) {
  return {
    id: row.id,
    timestamp: row.timestamp,
    actor_id: row.actorId || null,
    actor_name: row.actorName,
    role: row.role || null,
    module: row.module,
    action: row.action,
    record_type: row.recordType,
    record_id: row.recordId || null,
    before_data: row.before || null,
    after_data: row.after || null,
    reason: row.reason || null,
    data: row,
  }
}

function historyRemote(row: HistoryRecord) {
  return {
    id: row.id,
    entity: row.entity,
    record_id: row.recordId,
    version: row.version,
    captured_at: row.capturedAt,
    event_id: row.eventId || null,
    deleted: Boolean(row.deleted),
    snapshot: row.snapshot,
    data: row,
  }
}

function fromData<T>(row: Record<string, unknown>): T | null {
  const data = row.data
  return data && typeof data === 'object' ? data as T : null
}

async function syncAppendOnlyTable<T extends { id: string }>(
  table: string,
  readLocal: () => Promise<T[]>,
  putLocal: (row: T) => Promise<void>,
  mapRemoteToLocal: (row: Record<string, unknown>) => T | null,
  mapLocalToRemote: (row: T) => Record<string, unknown>,
) {
  if (!supabase) return
  const { data: remoteRows, error } = await supabase.from(table).select('*').limit(5000)
  if (error) throw error
  const localRows = await readLocal()
  const remoteMap = new Map(((remoteRows || []) as Record<string, unknown>[]).map(row => [String(row.id || ''), row]))
  const localMap = new Map(localRows.map(row => [row.id, row]))

  for (const remote of remoteMap.values()) {
    const id = String(remote.id || '')
    if (id && !localMap.has(id)) {
      const converted = mapRemoteToLocal(remote)
      if (converted) await putLocal(converted)
    }
  }

  const missing = localRows.filter(row => !remoteMap.has(row.id)).map(mapLocalToRemote)
  if (missing.length) {
    const { error: insertError } = await supabase.from(table).insert(missing)
    if (insertError && !/duplicate|23505/i.test(insertError.message)) throw insertError
  }
}

async function syncProfiles() {
  if (!supabase) return
  const { data, error } = await supabase.from('profiles').select('id, name, role, rank, active, permissions, auth_email, legacy_id, updated_at').limit(500)
  if (error) throw error

  const remoteProfiles = (data || []) as Record<string, unknown>[]
  const localUsers = await db.users.toArray()
  const localById = new Map(localUsers.map(user => [user.id, user]))
  const localByLegacy = new Map(localUsers.filter(user => user.legacyId).map(user => [user.legacyId!, user]))
  let session: User | null = null
  try {
    const rawSession = localStorage.getItem('smaky-session')
    session = rawSession ? JSON.parse(rawSession) as User : null
  } catch {
    session = null
  }

  setDbSyncApplying(true)
  try {
    for (const profile of remoteProfiles) {
      const id = String(profile.id || '')
      if (!id) continue
      const legacyId = String(profile.legacy_id || '') || undefined
      const current: User | undefined = localById.get(id) || (legacyId ? localByLegacy.get(legacyId) : undefined)
      const role = String(profile.role || 'employee') as 'manager' | 'admin' | 'employee'
      const next: User = {
        ...(current || {}),
        id,
        legacyId: legacyId || current?.legacyId,
        authEmail: String(profile.auth_email || current?.authEmail || ''),
        name: String(profile.name || current?.name || 'Usuario'),
        role: role === 'manager' || role === 'admin' ? role : 'employee',
        rank: String(profile.rank || current?.rank || 'Trabajador'),
        active: Boolean(profile.active),
        permissions: Array.isArray(profile.permissions) ? profile.permissions as import('./types').PermissionKey[] : current?.permissions,
        pin: current?.pin || '',
        updatedAt: String(profile.updated_at || current?.updatedAt || new Date().toISOString()),
      }
      if (current && current.id !== id) await db.users.delete(current.id)
      await db.users.put(next)

      if (session && (session.id === id || session.id === current?.id || (legacyId && session.legacyId === legacyId))) {
        if (!next.active) {
          localStorage.removeItem('smaky-session')
          await supabase.auth.signOut()
          window.dispatchEvent(new Event('smaky-auth-change'))
          session = null
        } else {
          localStorage.setItem('smaky-session', JSON.stringify(next))
          window.dispatchEvent(new Event('smaky-auth-change'))
          session = next
        }
      }
    }
  } finally {
    setDbSyncApplying(false)
  }
}

export async function syncNow() {
  if (!supabaseConfigured || !supabase || !navigator.onLine || syncing) return
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) return

  syncing = true
  try {
    await syncProfiles()

    const tasks = [
      syncJsonTable<Product>('products', () => db.products.toArray(), async row => { await db.products.put(row) }, row => fromData<Product>(row), productRemote),
      syncJsonTable<Customer>('customers', () => db.customers.toArray(), async row => { await db.customers.put(row) }, row => fromData<Customer>(row), customerRemote),
      syncJsonTable<Order>('orders', () => db.orders.toArray(), async row => { await db.orders.put(row) }, row => fromData<Order>(row), orderRemote),
      syncJsonTable<Sale>('sales', () => db.sales.toArray(), async row => { await db.sales.put(row) }, row => fromData<Sale>(row), saleRemote),
      syncJsonTable<CashClosure>('cash_closures', () => db.closures.toArray(), async row => { await db.closures.put(row) }, row => fromData<CashClosure>(row), closureRemote),
      syncJsonTable<SystemSetting>('settings', () => db.settings.toArray(), async row => { await db.settings.put(row) }, row => fromData<SystemSetting>(row), settingRemote),
      syncAppendOnlyTable<AuditEvent>('audit_events', () => db.auditEvents.toArray(), async row => { await db.auditEvents.put(row) }, row => fromData<AuditEvent>(row), auditRemote),
      syncAppendOnlyTable<HistoryRecord>('history_records', () => db.historyRecords.toArray(), async row => { await db.historyRecords.put(row) }, row => fromData<HistoryRecord>(row), historyRemote),
    ]

    for (const task of tasks) {
      setDbSyncApplying(true)
      try {
        await task
      } catch (error) {
        console.warn('Smaky Supabase sync skipped:', error)
      } finally {
        setDbSyncApplying(false)
      }
    }
  } finally {
    syncing = false
  }
}

export function scheduleSync(delayMs = 1200) {
  if (!supabaseConfigured) return
  if (syncTimer !== null) window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => { syncTimer = null; void syncNow() }, delayMs)
}

export function startSync() {
  if (started) return
  started = true
  setDbMutationListener(() => scheduleSync())
  window.addEventListener('online', () => scheduleSync(300))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(300)
  })
  periodicTimer = window.setInterval(() => { void syncNow() }, 15_000)
}

export function stopSync() {
  if (syncTimer !== null) window.clearTimeout(syncTimer)
  if (periodicTimer !== null) window.clearInterval(periodicTimer)
  syncTimer = null
  periodicTimer = null
}

export async function syncAfterLogin() {
  await delay(0)
  await syncNow()
}
