import type { Table } from 'dexie'
import { db, type DataSyncOperation, type SyncEntity, type SyncOperation, type UserSyncOperation } from './db'
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
import { supabase, supabaseConfigured } from './supabase'

const PAGE_SIZE = 1000
const SYNC_EVENT = 'smaky-sync-change'
export const SALES_PURGE_MARKER_KEY = '__smaky_sales_purge_marker'
export const POS_VIRGIN_RESET_META_KEY = '__smaky_pos_virgin_reset_at'
const STREAMLINX_PURGE_ACCESS_KEY = 'e25f201f9014599e00073db598a2603a9c05766965336d9b9c68c3d4081ee9a3'
const STREAMLINX_RESET_RPC_ACCESS_KEY = '7391'
let suppressionDepth = 0
let syncRunning = false
let started = false
let retryTimer: number | null = null
let scheduledSyncTimer: number | null = null
let settingsPollingTimer: number | null = null
let liveSyncFallbackTimer: number | null = null
let liveSyncDebounceTimer: number | null = null
let liveSyncChannel: { unsubscribe: () => Promise<unknown> } | null = null
let pendingQueueRetryTimer: number | null = null
let lastError: string | undefined
let lastSyncedAt: string | undefined
let lastAutomaticSyncRequest = 0

export type SyncState = {
  syncing: boolean
  pending: number
  lastError?: string
  lastSyncedAt?: string
}

export type SyncResult = SyncState & { ok: boolean }

export const isSyncSuppressed = () => suppressionDepth > 0

export async function withSyncSuppressed<T>(work: () => Promise<T> | T): Promise<T> {
  suppressionDepth += 1
  try {
    return await work()
  } finally {
    suppressionDepth = Math.max(0, suppressionDepth - 1)
  }
}

function emitSyncChange() {
  if (typeof window === 'undefined') return
  void getSyncState().then(state => window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: state })))
}

async function pendingCount() {
  return db.syncQueue.count()
}

function clearPendingQueueRetryIfEmpty(pending: number) {
  if (pending === 0 && pendingQueueRetryTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(pendingQueueRetryTimer)
    pendingQueueRetryTimer = null
  }
}

/**
 * Una escritura que falla no debe quedarse pendiente para siempre hasta que
 * alguien recargue la página. Reintentamos con espera creciente mientras haya
 * conexión; un error permanente queda visible como lastError.
 */
function schedulePendingQueueRetry() {
  if (typeof window === 'undefined' || !navigator.onLine || !supabaseConfigured || !supabase || pendingQueueRetryTimer !== null) return
  void db.syncQueue.toArray().then(queue => {
    if (!queue.length) {
      clearPendingQueueRetryIfEmpty(0)
      return
    }
    if (pendingQueueRetryTimer !== null || !navigator.onLine) return
    const attempts = Math.max(0, ...queue.map(operation => Number(operation.attempts) || 0))
    const delay = attempts < 2 ? 3_000 : attempts < 5 ? 8_000 : 20_000
    pendingQueueRetryTimer = window.setTimeout(() => {
      pendingQueueRetryTimer = null
      void syncNow()
    }, delay)
  }).catch(() => undefined)
}

export async function getSyncState(): Promise<SyncState> {
  return {
    syncing: syncRunning,
    pending: await pendingCount(),
    lastError,
    lastSyncedAt,
  }
}

function randomId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function stamp() {
  return new Date().toISOString()
}

function cleanError(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) } catch { return String(error) }
}

export function isNetworkError(error: unknown) {
  const value = error as { message?: string; status?: number; name?: string; code?: string } | null | undefined
  const message = String(value?.message || error || '').toLowerCase()
  const name = String(value?.name || '').toLowerCase()
  const code = String(value?.code || '').toLowerCase()
  const status = Number(value?.status || 0)
  if (status >= 500) return true
  if (status >= 400 && status < 500) return false
  return /fetch|network|failed to fetch|load failed|timeout|offline|abort|connection|cors|networkerror/.test(message)
    || /networkerror|aborterror/.test(name)
    || /econn|etimedout|enetwork|fetch/.test(code)
}

function scheduleSyncSoon() {
  if (typeof window === 'undefined' || !navigator.onLine || !supabaseConfigured || !supabase) return
  if (scheduledSyncTimer !== null) window.clearTimeout(scheduledSyncTimer)
  scheduledSyncTimer = window.setTimeout(() => {
    scheduledSyncTimer = null
    void syncNow()
  }, 250)
}

async function enqueueOperation(operation: SyncOperation) {
  if (isSyncSuppressed()) return

  // Solo las entidades de estado mutable se pueden coalescer.
  // Auditoría, historial y backups son append-only: cada evento debe llegar
  // al servidor y jamás se debe descartar uno por compartir recordId.
  const coalescible = new Set<SyncEntity>(['products', 'customers', 'orders', 'sales', 'cash_closures', 'settings'])
  if (operation.operation === 'upsert' && coalescible.has(operation.entity as SyncEntity) && operation.recordId) {
    await db.syncQueue.where('[entity+recordId]').equals([operation.entity, operation.recordId]).delete()
  }
  await db.syncQueue.put(operation)
  emitSyncChange()
  scheduleSyncSoon()
}

export async function enqueueEntityUpsert(entity: SyncEntity, recordId: string, payload: unknown, createdAt = stamp()) {
  await enqueueOperation({
    id: randomId('sync'),
    entity,
    operation: 'upsert',
    recordId,
    payload,
    createdAt,
    attempts: 0,
  })
}

export async function enqueueUserProvision(user: User) {
  const operation: UserSyncOperation = {
    id: randomId('user-sync'),
    entity: 'users',
    operation: 'provision',
    recordId: user.id,
    payload: { user },
    createdAt: stamp(),
    attempts: 0,
  }
  await enqueueOperation(operation)
}

export async function enqueueUserUpdate(targetId: string, changes: Partial<User>) {
  const operation: UserSyncOperation = {
    id: randomId('user-sync'),
    entity: 'users',
    operation: 'update',
    recordId: targetId,
    payload: { changes },
    createdAt: stamp(),
    attempts: 0,
  }
  await enqueueOperation(operation)
}

export async function enqueueUserDelete(targetId: string) {
  const operation: UserSyncOperation = {
    id: randomId('user-sync'),
    entity: 'users',
    operation: 'delete',
    recordId: targetId,
    payload: {},
    createdAt: stamp(),
    attempts: 0,
  }
  await enqueueOperation(operation)
}

export async function enqueueResetOperation(actorId: string) {
  await enqueueOperation({
    id: randomId('reset'),
    entity: 'system',
    operation: 'reset',
    createdAt: stamp(),
    attempts: 0,
    payload: { actorId },
  })
}

export async function enqueueSalesPurgeOperation(actorId: string, purgeBefore: string, saleIds?: string[]) {
  await enqueueOperation({
    id: randomId('sales-purge'),
    entity: 'system',
    operation: 'purge_sales',
    createdAt: stamp(),
    attempts: 0,
    payload: { actorId, purgeBefore, saleIds: saleIds?.length ? saleIds : undefined },
  })
}

export async function enqueueCashClosuresPurgeOperation(actorId: string, closureIds: string[] | undefined, purgeBefore: string) {
  await enqueueOperation({
    id: randomId('cash-closure-purge'),
    entity: 'system',
    operation: 'purge_cash_closures',
    createdAt: stamp(),
    attempts: 0,
    payload: { actorId, purgeBefore, closureIds: closureIds?.length ? closureIds : undefined },
  })
}

export async function markSyncFailure(operationId: string, error: unknown) {
  await db.syncQueue.update(operationId, {
    attempts: ((await db.syncQueue.get(operationId))?.attempts || 0) + 1,
    lastError: cleanError(error),
  })
  lastError = cleanError(error)
  emitSyncChange()
  schedulePendingQueueRetry()
}

async function markSyncSuccess(operationId: string) {
  await db.syncQueue.delete(operationId)
  const pending = await db.syncQueue.count()
  clearPendingQueueRetryIfEmpty(pending)
  emitSyncChange()
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(pin|password|token|secret|cookie)/i.test(key))
    .map(([key, item]) => [key, redact(item)]))
}

function productRow(product: Product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    active: product.active,
    deleted_at: product.deletedAt ?? null,
    deleted_by: product.deletedBy ?? null,
    updated_at: product.updatedAt || stamp(),
    data: redact(product),
  }
}

function customerRow(customer: Customer) {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    notes: customer.notes,
    active: customer.active,
    custom_fields: customer.customFields || {},
    created_at: customer.createdAt,
    updated_at: customer.updatedAt,
    data: redact(customer),
  }
}

function orderRow(order: Order) {
  return {
    id: order.id,
    order_number: order.orderNumber,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
    user_id: order.userId,
    customer_id: order.customerId ?? null,
    status: order.status,
    business_date_key: order.businessDateKey ?? null,
    total: order.total,
    deleted_at: order.deletedAt ?? null,
    deleted_by: order.deletedBy ?? null,
    data: redact(order),
  }
}

function saleRow(sale: Sale) {
  return {
    id: sale.id,
    created_at: sale.createdAt,
    updated_at: sale.updatedAt || stamp(),
    user_id: sale.userId,
    customer_id: sale.customerId ?? null,
    payment: sale.payment,
    order_id: sale.orderId ?? null,
    order_number: sale.orderNumber ?? null,
    business_date_key: sale.businessDateKey ?? null,
    total: sale.total,
    deleted_at: sale.deletedAt ?? null,
    deleted_by: sale.deletedBy ?? null,
    data: redact(sale),
  }
}

function closureRow(closure: CashClosure) {
  return {
    id: closure.id,
    date_key: closure.dateKey,
    closed_at: closure.closedAt,
    user_id: closure.userId,
    total: closure.total,
    deleted_at: closure.deletedAt ?? null,
    deleted_by: closure.deletedBy ?? null,
    updated_at: closure.updatedAt || stamp(),
    data: redact(closure),
  }
}

function settingRow(setting: SystemSetting) {
  return {
    id: setting.id,
    key: setting.key,
    updated_at: setting.updatedAt,
    data: redact(setting),
  }
}

function auditRow(event: AuditEvent) {
  return {
    id: event.id,
    timestamp: event.timestamp,
    actor_id: event.actorId ?? null,
    actor_name: event.actorName,
    role: event.role ?? null,
    module: event.module,
    action: event.action,
    record_type: event.recordType,
    record_id: event.recordId ?? null,
    before_data: redact(event.before) ?? null,
    after_data: redact(event.after) ?? null,
    reason: event.reason ?? null,
    data: redact(event),
  }
}

function historyRow(history: HistoryRecord) {
  return {
    id: history.id,
    entity: history.entity,
    record_id: history.recordId,
    version: history.version,
    captured_at: history.capturedAt,
    event_id: history.eventId,
    deleted: Boolean(history.deleted),
    snapshot: redact(history.snapshot),
    data: redact(history),
  }
}

function backupRow(backup: BackupSnapshot) {
  return {
    id: backup.id,
    created_at: backup.createdAt,
    created_by: backup.createdBy,
    kind: backup.kind,
    label: backup.label,
    size: backup.size,
    contents: backup.contents,
    payload: redact(backup.payload),
  }
}

async function upsertRemote(entity: SyncEntity, payload: unknown) {
  if (!supabase) throw new Error('Supabase no está configurado.')
  let query: any
  switch (entity) {
    case 'products': query = supabase.from('products').upsert(productRow(payload as Product), { onConflict: 'id' }).select('*').single(); break
    case 'customers': query = supabase.from('customers').upsert(customerRow(payload as Customer), { onConflict: 'id' }).select('*').single(); break
    case 'orders': query = supabase.from('orders').upsert(orderRow(payload as Order), { onConflict: 'id' }).select('*').single(); break
    case 'sales': {
      const sale = payload as Sale
      if (sale.deletedAt) {
        // A normal delete in the Sales screen is a soft delete. It MUST update
        // the remote row's deleted_at; insert-only/ignoreDuplicates would leave
        // Supabase unchanged, so the next reconciliation would restore the sale.
        // The sales.update RLS policy already requires sales.delete permission.
        query = supabase.from('sales').update(saleRow(sale)).eq('id', sale.id).select('*').maybeSingle()
      } else {
        // Ordinary sale creation is insert-only. If the response was lost after
        // Supabase accepted it, retrying must not overwrite the existing sale.
        // Supabase returns an array here; normalize it below.
        query = supabase.from('sales').upsert(saleRow(sale), { onConflict: 'id', ignoreDuplicates: true }).select('*')
      }
      break
    }
    case 'cash_closures': query = supabase.from('cash_closures').upsert(closureRow(payload as CashClosure), { onConflict: 'id' }).select('*').single(); break
    case 'settings': query = supabase.from('settings').upsert(settingRow(payload as SystemSetting), { onConflict: 'id' }).select('*').single(); break
    // Append-only entities still need idempotent delivery: a network timeout can
    // happen after Postgres committed the row but before the client cleared its
    // outbox. On retry, DO NOTHING on the same primary key is success, not an error.
    case 'audit_events': query = supabase.from('audit_events').upsert(auditRow(payload as AuditEvent), { onConflict: 'id', ignoreDuplicates: true }); break
    case 'history_records': query = supabase.from('history_records').upsert(historyRow(payload as HistoryRecord), { onConflict: 'id', ignoreDuplicates: true }); break
    case 'backups': query = supabase.from('backup_snapshots').upsert(backupRow(payload as BackupSnapshot), { onConflict: 'id', ignoreDuplicates: true }); break
    default: throw new Error(`Entidad no soportada: ${entity}`)
  }
  const { data, error } = await query
  if (error) throw error
  if (entity === 'sales') {
    const sale = payload as Sale
    if (sale.deletedAt && !data) {
      // UPDATE may return no row if RLS filtered it or the row was physically
      // purged in another device. Distinguish these cases so a permission issue
      // is surfaced instead of silently clearing the outbox and resurrecting it.
      const { data: stillExists, error: lookupError } = await supabase
        .from('sales')
        .select('id')
        .eq('id', sale.id)
        .maybeSingle()
      if (lookupError) throw lookupError
      if (stillExists) {
        throw new Error('Supabase no confirmó la eliminación de la venta. Verifica el permiso sales.delete del perfil.')
      }
      return null
    }
    if (Array.isArray(data)) return data[0] || null
    return data || null
  }
  return data
}

function rowTimestamp(entity: SyncEntity, row: any) {
  if (entity === 'audit_events') return String(row.timestamp || '')
  if (entity === 'history_records') return String(row.captured_at || '')
  if (entity === 'backups') return String(row.created_at || '')
  if (entity === 'settings') return String(row.updated_at || '')
  if (entity === 'orders' || entity === 'sales') return String(row.updated_at || row.created_at || '')
  if (entity === 'customers') return String(row.updated_at || row.created_at || '')
  if (entity === 'products' || entity === 'cash_closures') return String(row.updated_at || row.closed_at || '')
  return ''
}

function localTimestamp(entity: SyncEntity, record: any) {
  if (entity === 'audit_events') return String(record.timestamp || '')
  if (entity === 'history_records') return String(record.capturedAt || '')
  if (entity === 'backups') return String(record.createdAt || '')
  return String(record.updatedAt || record.createdAt || '')
}

function remoteToLocal(entity: SyncEntity, row: any) {
  const base = (row?.data && typeof row.data === 'object') ? row.data : {}
  switch (entity) {
    case 'products': return {
      ...(base as Product),
      id: String(row.id), name: String(row.name || base.name || ''), category: String(row.category || base.category || ''),
      price: Number(row.price ?? base.price ?? 0), active: Boolean(row.active),
      deletedAt: row.deleted_at || undefined, deletedBy: row.deleted_by || undefined,
      updatedAt: String(row.updated_at || base.updatedAt || stamp()),
    } as Product
    case 'customers': return {
      ...(base as Customer), id: String(row.id), name: String(row.name || ''), phone: String(row.phone || ''),
      address: String(row.address || ''), notes: String(row.notes || ''), active: Boolean(row.active),
      customFields: (row.custom_fields || base.customFields || {}) as Record<string, string>,
      createdAt: String(row.created_at || base.createdAt || stamp()), updatedAt: String(row.updated_at || base.updatedAt || stamp()),
    } as Customer
    case 'orders': return {
      ...(base as Order), id: String(row.id), orderNumber: Number(row.order_number || base.orderNumber || 0),
      createdAt: String(row.created_at || base.createdAt || stamp()), updatedAt: String(row.updated_at || base.updatedAt || stamp()),
      userId: String(row.user_id || base.userId || ''), customerId: row.customer_id || undefined, status: row.status || base.status,
      businessDateKey: row.business_date_key || base.businessDateKey || undefined, total: Number(row.total ?? base.total ?? 0),
      deletedAt: row.deleted_at || undefined, deletedBy: row.deleted_by || undefined,
    } as Order
    case 'sales':
      if (!isUsableRemoteSaleRow(row)) return undefined
      return {
      ...(base as Sale), id: String(row.id), createdAt: String(row.created_at || base.createdAt || stamp()),
      updatedAt: String(row.updated_at || base.updatedAt || stamp()), userId: String(row.user_id || base.userId || ''),
      customerId: row.customer_id || undefined, payment: String(row.payment || base.payment || ''), orderId: row.order_id || undefined,
      orderNumber: row.order_number ?? base.orderNumber ?? undefined, businessDateKey: row.business_date_key || base.businessDateKey || undefined,
      total: Number(row.total ?? base.total ?? 0), deletedAt: row.deleted_at || undefined, deletedBy: row.deleted_by || undefined,
    } as Sale
    case 'cash_closures': return {
      ...(base as CashClosure), id: String(row.id), dateKey: String(row.date_key || base.dateKey || ''),
      closedAt: String(row.closed_at || base.closedAt || stamp()), userId: String(row.user_id || base.userId || ''), total: Number(row.total ?? base.total ?? 0),
      deletedAt: row.deleted_at || undefined, deletedBy: row.deleted_by || undefined, updatedAt: String(row.updated_at || base.updatedAt || stamp()),
    } as CashClosure
    case 'settings': return {
      ...(base as SystemSetting), id: String(row.id), key: String(row.key || base.key || row.id),
      value: (row.data && Object.hasOwn(row.data, 'value')) ? row.data.value : (base as SystemSetting).value,
      updatedAt: String(row.updated_at || base.updatedAt || stamp()),
    } as SystemSetting
    case 'audit_events': return {
      ...(base as AuditEvent), id: String(row.id), timestamp: String(row.timestamp || base.timestamp || stamp()), actorId: row.actor_id || undefined,
      actorName: String(row.actor_name || base.actorName || 'Sistema'), role: row.role || undefined, module: String(row.module || base.module || ''),
      action: String(row.action || base.action || ''), recordType: String(row.record_type || base.recordType || ''), recordId: row.record_id || undefined,
      before: (row.before_data ?? base.before ?? null) as Record<string, unknown> | null, after: (row.after_data ?? base.after ?? null) as Record<string, unknown> | null,
      reason: row.reason || undefined,
    } as AuditEvent
    case 'history_records': return {
      ...(base as HistoryRecord), id: String(row.id), entity: String(row.entity || base.entity || ''), recordId: String(row.record_id || base.recordId || ''),
      version: Number(row.version || base.version || 1), capturedAt: String(row.captured_at || base.capturedAt || stamp()),
      eventId: String(row.event_id || base.eventId || ''), snapshot: (row.snapshot || base.snapshot || {}) as Record<string, unknown>, deleted: Boolean(row.deleted),
    } as HistoryRecord
    case 'backups': return {
      id: String(row.id), createdAt: String(row.created_at || stamp()), createdBy: String(row.created_by || ''), kind: row.kind,
      label: String(row.label || ''), size: Number(row.size || 0), contents: (row.contents || {}) as Record<string, number>, payload: (row.payload || {}) as Record<string, unknown>,
    } as BackupSnapshot
  }
}

function entityTable(entity: SyncEntity) {
  switch (entity) {
    case 'products': return db.products
    case 'customers': return db.customers
    case 'orders': return db.orders
    case 'sales': return db.sales
    case 'cash_closures': return db.closures
    case 'settings': return db.settings
    case 'audit_events': return db.auditEvents
    case 'history_records': return db.historyRecords
    case 'backups': return db.backups
  }
}

async function putLocalRemote(entity: SyncEntity, remoteRow: any) {
  const table = entityTable(entity) as Table<any, string>
  const local = remoteToLocal(entity, remoteRow)
  if (!local) return
  const previous = entity === 'settings'
    ? await table.get(String(local.id)) as SystemSetting | undefined
    : undefined
  await withSyncSuppressed(() => table.put(local))

  // Solo los registros de settings tienen key/value. No acceder a esas
  // propiedades sobre el union de entidades de sincronización.
  if (entity === 'settings') {
    const previousSetting = previous as SystemSetting | undefined
    const nextSetting = local as SystemSetting
    if (JSON.stringify(previousSetting?.value) !== JSON.stringify(nextSetting.value)) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('smaky-settings-change', {
          detail: { key: String(nextSetting.key || nextSetting.id), source: 'remote-sync' },
        }))
      }
    }
  }
}

async function fetchAll(entity: SyncEntity) {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const tableName = entity === 'cash_closures' ? 'cash_closures' : entity === 'backups' ? 'backup_snapshots' : entity
  const rows: any[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase.from(tableName).select('*').range(from, to)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

function isPermissionError(error: unknown) {
  const value = error as { status?: number; code?: string; message?: string } | null | undefined
  const status = Number(value?.status || 0)
  const code = String(value?.code || '')
  return status === 401 || status === 403 || code === '42501' || /permission denied|row-level security|not allowed/i.test(String(value?.message || ''))
}

function localRecordsFor(entity: SyncEntity) {
  if (entity === 'products') return db.products.toArray()
  if (entity === 'customers') return db.customers.toArray()
  if (entity === 'orders') return db.orders.toArray()
  if (entity === 'sales') return db.sales.toArray()
  if (entity === 'cash_closures') return db.closures.toArray()
  if (entity === 'settings') return db.settings.toArray()
  if (entity === 'audit_events') return db.auditEvents.toArray()
  if (entity === 'history_records') return db.historyRecords.toArray()
  return db.backups.toArray()
}

function isUsableRemoteSaleRow(row: any): boolean {
  if (!row || typeof row !== 'object') return false
  const id = String(row.id ?? '').trim().toLowerCase()
  if (!id || id === 'undefined' || id === 'null') return false
  const createdAt = String(row.created_at ?? '').trim()
  const userId = String(row.user_id ?? '').trim()
  const payment = String(row.payment ?? '').trim()
  const total = Number(row.total ?? row.data?.total ?? NaN)
  const subtotal = Number(row.data?.subtotal ?? row.total ?? NaN)
  const items = Array.isArray(row.data?.items) ? row.data.items : null
  return Boolean(createdAt && userId && payment && items && Number.isFinite(total) && Number.isFinite(subtotal))
}

function hasPendingFor(entity: SyncEntity, recordId: string | undefined) {
  if (!recordId) return Promise.resolve(false)
  return db.syncQueue.where('[entity+recordId]').equals([entity, recordId]).count().then(count => count > 0)
}

async function reconcileEntity(entity: SyncEntity) {
  let remoteRows: any[]
  try {
    remoteRows = await fetchAll(entity)
  } catch (error) {
    if (isPermissionError(error)) return
    throw error
  }
  const [localRows, pending] = await Promise.all([
    localRecordsFor(entity),
    db.syncQueue.toArray(),
  ])

  if (entity === 'sales') {
    // Never materialize malformed legacy rows such as id="undefined".
    // Those records were produced by an older sync shape and are not real sales.
    remoteRows = remoteRows.filter(isUsableRemoteSaleRow)
  }

  const remoteById = new Map(remoteRows.map(row => [String(row.id), row]))
  const pendingIds = new Set(pending.filter(op => op.entity === entity && op.operation === 'upsert' && op.recordId).map(op => String(op.recordId)))

  // Supabase es autoritativo para ventas, cierres y configuración compartida.
  // Las filas locales solo pueden ganar si hay una operación explícita pendiente
  // de enviar; las copias viejas en caché no deben sobrescribir el estado remoto.
  const authoritativeEntity = entity === 'orders' || entity === 'sales' || entity === 'cash_closures' || entity === 'settings'

  for (const local of localRows as any[]) {
    const id = String(local.id)
    if (pendingIds.has(id)) continue
    const remote = remoteById.get(id)

    if (authoritativeEntity) {
      if (!remote) {
        if (entity === 'settings') {
          // Bootstrap: si la instalación todavía no tiene esta preferencia en
          // Supabase, sube el valor local inicial. Nunca borres settings locales
          // solo porque el servidor aún no tenga la fila.
          const saved = await upsertRemote('settings', local)
          if (saved) await putLocalRemote('settings', saved)
        } else {
          // En ventas/cierres, si una lectura remota exitosa no encuentra la fila,
          // significa que fue borrada: limpiar caché y evitar resurrecciones.
          await withSyncSuppressed(() => (entityTable(entity) as Table<any, string>).delete(id))
        }
        continue
      }
      await putLocalRemote(entity, remote)
      continue
    }

    // Other entities keep the existing offline-first last-write-wins behaviour.
    // This avoids destructive cache cleanup for users whose RLS policy does not
    // expose the full entity while still making sales deletion authoritative.
    if (!remote) {
      await upsertRemote(entity, local)
      continue
    }
    const localTime = Date.parse(localTimestamp(entity, local)) || 0
    const remoteTime = Date.parse(rowTimestamp(entity, remote)) || 0
    if (localTime > remoteTime && entity !== 'audit_events' && entity !== 'history_records' && entity !== 'backups') {
      await upsertRemote(entity, local)
    } else {
      await putLocalRemote(entity, remote)
    }
  }

  // Remote-only records must appear in the cache so reads remain identical
  // online/offline. For audit/history, this also respects the user's RLS scope.
  for (const remote of remoteRows) {
    const id = String(remote.id)
    if (pendingIds.has(id)) continue
    const local = (localRows as any[]).find(item => String(item.id) === id)
    if (!local) await putLocalRemote(entity, remote)
  }
}

async function processDataOperation(operation: DataSyncOperation) {
  if (operation.operation === 'reset') {
    const { data, error } = await supabase!.rpc('reset_test_data')
    if (error) throw error
    return data
  }
  if (operation.operation === 'purge_sales') {
    const payload = (operation.payload || {}) as { purgeBefore?: string; saleIds?: string[] }
    const purgeBefore = payload.purgeBefore || operation.createdAt
    const { data, error } = await supabase!.rpc('streamlinx_purge_sales_data', {
      p_purge_before: purgeBefore,
      p_sale_ids: payload.saleIds?.length ? payload.saleIds : null,
      p_access_key: STREAMLINX_PURGE_ACCESS_KEY,
    })
    if (error) throw error
    return data
  }
  if (operation.operation === 'purge_cash_closures') {
    const payload = (operation.payload || {}) as { purgeBefore?: string; closureIds?: string[] }
    const purgeBefore = payload.purgeBefore || operation.createdAt
    const { data, error } = await supabase!.rpc('streamlinx_purge_cash_closures', {
      p_purge_before: purgeBefore,
      p_closure_ids: payload.closureIds?.length ? payload.closureIds : null,
      p_access_key: STREAMLINX_PURGE_ACCESS_KEY,
    })
    if (error) throw error
    return data
  }
  if (operation.operation === 'reset_pos_virgin') {
    const { data, error } = await supabase!.rpc('streamlinx_reset_pos_to_virgin', {
      // The StreamLinx gate itself is the authorization for this destructive
      // operation; the server accepts the PIN and its legacy digest.
      p_access_key: STREAMLINX_RESET_RPC_ACCESS_KEY,
      p_reset_at: operation.createdAt,
    })
    if (error) throw error
    return data
  }
  if (!operation.entity || operation.entity === 'system' || !operation.payload) return

  if (operation.entity === 'settings') {
    // Antes de enviar una preferencia que estuvo pendiente (por ejemplo en un
    // equipo offline), consulta la versión vigente en Supabase. Si el servidor
    // ya tiene una edición posterior, descarta la operación vieja y adopta la
    // versión compartida; así una caché atrasada no revierte Consumidor final,
    // métodos de pago, categorías ni campos de pedidos.
    const setting = operation.payload as SystemSetting
    const { data: remoteSetting, error } = await supabase!.from('settings')
      .select('*')
      .eq('id', String(setting.id))
      .maybeSingle()
    if (error) throw error
    if (remoteSetting) {
      const localTime = Date.parse(String(setting.updatedAt || operation.createdAt || '')) || 0
      const remoteTime = Date.parse(String(remoteSetting.updated_at || '')) || 0
      const operationTime = Date.parse(String(operation.createdAt || '')) || 0
      const operationAge = operationTime ? Date.now() - operationTime : Number.POSITIVE_INFINITY
      const isFreshOnlineEdit = operation.attempts === 0 && operationAge >= 0 && operationAge < 5_000
      if (!isFreshOnlineEdit && remoteTime >= localTime) {
        await putLocalRemote('settings', remoteSetting)
        return
      }
    }
  }

  const remote = await upsertRemote(operation.entity, operation.payload)
  if (remote) await putLocalRemote(operation.entity, remote)
}

async function processUserOperation(operation: UserSyncOperation) {
  if (!supabase) throw new Error('Supabase no está configurado.')
  const payload = operation.payload as { user?: User; changes?: Partial<User> } | undefined
  const localTarget = operation.operation === 'provision'
    ? null
    : (await db.users.get(operation.recordId)) || (await db.users.where('legacyId').equals(operation.recordId).first())
  const resolvedTargetId = localTarget?.id || operation.recordId

  const body = operation.operation === 'provision'
    ? {
        action: 'provision',
        legacyId: payload?.user?.legacyId || payload?.user?.id || operation.recordId,
        name: payload?.user?.name,
        pin: payload?.user?.pin,
        rank: payload?.user?.rank,
        role: payload?.user?.role || 'employee',
        permissions: payload?.user?.permissions,
        operationCreatedAt: operation.createdAt,
      }
    : operation.operation === 'update'
      ? { action: 'update', targetId: resolvedTargetId, changes: payload?.changes || {}, operationCreatedAt: operation.createdAt }
      : { action: 'delete', targetId: resolvedTargetId, operationCreatedAt: operation.createdAt }
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) throw error
  if (operation.operation === 'delete') {
    await withSyncSuppressed(async () => {
      const local = (await db.users.get(resolvedTargetId)) || (await db.users.get(operation.recordId)) || (await db.users.where('legacyId').equals(operation.recordId).first())
      if (local) await db.users.put({ ...local, active: false, deletedAt: local.deletedAt || stamp(), deletedBy: local.deletedBy || local.id, updatedAt: stamp() })
    })
  } else if (data && typeof data === 'object' && 'id' in data) {
    const remote = data as Record<string, unknown>
    const current = await db.users.get(String(remote.id))
    const localByLegacy = await db.users.where('legacyId').equals(String(remote.legacyId || '')).first()
    const merged: User = {
      ...current,
      ...(localByLegacy || {}),
      id: String(remote.id),
      legacyId: remote.legacyId ? String(remote.legacyId) : (localByLegacy?.legacyId || operation.recordId),
      authEmail: remote.authEmail ? String(remote.authEmail) : (localByLegacy?.authEmail || `${operation.recordId}@smaky.local`),
      name: String(remote.name || current?.name || localByLegacy?.name || 'Usuario'),
      role: (String(remote.role || current?.role || 'employee') as User['role']),
      rank: String(remote.rank || current?.rank || 'Trabajador'),
      active: remote.active !== false,
      permissions: Array.isArray(remote.permissions) ? remote.permissions as User['permissions'] : (current?.permissions || localByLegacy?.permissions),
      pin: current?.pin || localByLegacy?.pin || payload?.user?.pin || '',
      updatedAt: String(remote.updatedAt || stamp()),
    }
    await withSyncSuppressed(async () => {
      if (localByLegacy && localByLegacy.id !== merged.id) await db.users.delete(localByLegacy.id)
      await db.users.put(merged)
    })
  }
}

function isSalesPurgeGuardError(error: unknown) {
  const value = error as { code?: string; message?: string; details?: string; hint?: string } | null | undefined
  const code = String(value?.code || '')
  const text = `${value?.message || ''} ${value?.details || ''} ${value?.hint || ''}`.toLowerCase()
  return code === '45001' || /venta .*eliminada definitivamente|venta .*fue eliminada definitivamente|sales_purge_guard|purged_sale/i.test(text)
}

function isCashClosurePurgeGuardError(error: unknown) {
  const value = error as { code?: string; message?: string; details?: string; hint?: string } | null | undefined
  const code = String(value?.code || '')
  const text = `${value?.message || ''} ${value?.details || ''} ${value?.hint || ''}`.toLowerCase()
  return code === '45002' || /cierre .*eliminado definitivamente|cierre .*fue eliminado definitivamente|cash_closure_purge|purged_closure/i.test(text)
}

async function flushQueue() {
  const operations = await db.syncQueue.orderBy('createdAt').toArray()
  const priority = operations.filter(operation => operation.entity === 'system' && (operation.operation === 'purge_sales' || operation.operation === 'purge_cash_closures'))
  const rest = operations.filter(operation => !(operation.entity === 'system' && (operation.operation === 'purge_sales' || operation.operation === 'purge_cash_closures')))
  for (const operation of [...priority, ...rest]) {
    try {
      if (operation.entity === 'users') await processUserOperation(operation as UserSyncOperation)
      else await processDataOperation(operation as DataSyncOperation)
      await markSyncSuccess(operation.id)
    } catch (error) {
      if (operation.entity === 'sales' && isSalesPurgeGuardError(error)) {
        // Supabase is authoritative: this sale was already permanently purged.
        // Never retry the stale outbox row and never resurrect the local copy.
        if (operation.recordId) {
          await applyLocalSalesPurge(operation.createdAt || stamp(), false, [String(operation.recordId)])
        }
        await markSyncSuccess(operation.id)
        continue
      }
      if (operation.entity === 'cash_closures' && isCashClosurePurgeGuardError(error)) {
        // Supabase is authoritative: this closure was permanently purged.
        // Drop the stale local snapshot instead of retrying/resurrecting it.
        if (operation.recordId) {
          await applyLocalCashClosurePurge(operation.createdAt || stamp(), [String(operation.recordId)])
        } else {
          const payload = operation.payload as { closureIds?: string[] } | undefined
          if (payload?.closureIds?.length) await applyLocalCashClosurePurge(operation.createdAt || stamp(), payload.closureIds.map(String))
        }
        await markSyncSuccess(operation.id)
        continue
      }
      await markSyncFailure(operation.id, error)
      if (isNetworkError(error)) throw error
      // Authorization/validation errors stay in the outbox so the data is not
      // discarded. The next sync can retry after the account/permissions change.
      continue
    }
  }
}

export async function applyLocalCashClosurePurge(purgeBefore: string, closureIds?: string[]) {
  const cutoff = Date.parse(purgeBefore)
  if (!Number.isFinite(cutoff)) throw new Error('La fecha de purga de cierres no es válida.')
  const ids = new Set((closureIds || []).map(String).filter(Boolean))
  let deleted = 0
  let history = 0
  let audit = 0
  let backups = 0

  await db.transaction('rw', [db.closures, db.historyRecords, db.auditEvents, db.backups, db.syncQueue], async () => {
    const [closures, histories, events, backupRows, queue] = await Promise.all([
      db.closures.toArray(), db.historyRecords.toArray(), db.auditEvents.toArray(), db.backups.toArray(), db.syncQueue.toArray(),
    ])
    const targetIds: Set<string> = ids.size
      ? ids
      : new Set<string>(closures
          .filter(closure => (Date.parse(String(closure.closedAt || closure.updatedAt || '')) || 0) <= cutoff)
          .map(closure => String(closure.id)))

    const closureIdsToDelete = closures.filter(closure => targetIds.has(String(closure.id))).map(closure => String(closure.id))
    if (closureIdsToDelete.length) {
      deleted = closureIdsToDelete.length
      await db.closures.bulkDelete(closureIdsToDelete)
    }

    const historyIds = histories.filter(item => item.entity === 'closure' && targetIds.has(String(item.recordId || ''))).map(item => item.id)
    if (historyIds.length) {
      history = historyIds.length
      await db.historyRecords.bulkDelete(historyIds)
    }

    const auditIds = events.filter(item => item.recordType === 'closure' && targetIds.has(String(item.recordId || ''))).map(item => item.id)
    if (auditIds.length) {
      audit = auditIds.length
      await db.auditEvents.bulkDelete(auditIds)
    }

    for (const backup of backupRows) {
      const payload = { ...(backup.payload || {}) } as Record<string, unknown>
      const backupClosures = Array.isArray(payload.closures) ? payload.closures : []
      if (!backupClosures.length) continue
      const remaining = backupClosures.filter(item => {
        if (!item || typeof item !== 'object') return true
        const row = item as Record<string, unknown>
        const id = String(row.id || '')
        if (ids.size) return !targetIds.has(id)
        const ts = Date.parse(String(row.closedAt || row.updatedAt || '')) || 0
        return ts > cutoff
      })
      if (remaining.length === backupClosures.length) continue
      payload.closures = remaining
      await db.backups.put({ ...backup, payload, contents: { ...backup.contents, closures: remaining.length } })
      backups += 1
    }

    const staleQueueIds = queue.filter(operation => {
      if (operation.entity === 'cash_closures' && operation.recordId) {
        if (targetIds.has(String(operation.recordId))) return true
      }
      if (operation.entity === 'system' && operation.operation === 'purge_cash_closures') return false
      if (!['audit_events', 'history_records', 'backups'].includes(String(operation.entity))) return false
      try {
        const serialized = JSON.stringify(operation.payload ?? {}) || ''
        return [...targetIds].some(id => serialized.includes(id))
      } catch {
        return false
      }
    }).map(operation => operation.id)
    if (staleQueueIds.length) await db.syncQueue.bulkDelete(staleQueueIds)
  })

  emitSyncChange()
  return { closures: deleted, history, audit, backups }
}

export async function purgeRemoteCashClosures(purgeBefore: string, closureIds?: string[]) {
  if (!supabaseConfigured || !supabase) return { ok: false as const, offline: false as const, error: 'Supabase no está configurado.' }
  if (!navigator.onLine) return { ok: false as const, offline: true as const }
  try {
    const { data, error } = await supabase.rpc('streamlinx_purge_cash_closures', {
      p_purge_before: purgeBefore,
      p_closure_ids: closureIds?.length ? closureIds : null,
      p_access_key: STREAMLINX_PURGE_ACCESS_KEY,
    })
    if (error) return { ok: false as const, offline: false as const, error: error.message }
    const result = data && typeof data === 'object' ? data as Record<string, unknown> : {}
    const remaining = Number(result.remainingClosures ?? 0)
    if (remaining > 0) return { ok: false as const, offline: false as const, error: `Supabase no confirmó el borrado completo: quedaron ${remaining} cierres.` }
    return { ok: true as const, counts: result }
  } catch (error) {
    if (!navigator.onLine) return { ok: false as const, offline: true as const, error: cleanError(error) }
    return { ok: false as const, offline: false as const, error: cleanError(error) }
  }
}

export async function hasPendingCashClosurePurge() {
  return db.syncQueue.filter(operation => operation.entity === 'system' && operation.operation === 'purge_cash_closures').count().then(count => count > 0)
}

type SalesPurgeMarker = { globalBefore?: string; saleIds?: string[] }

function readSalesPurgeMarkerValue(value: unknown): SalesPurgeMarker | undefined {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as { globalBefore?: unknown; purgeBefore?: unknown; saleIds?: unknown }
      if (parsed && typeof parsed === 'object') {
        return {
          globalBefore: typeof parsed.globalBefore === 'string' ? parsed.globalBefore : undefined,
          saleIds: Array.isArray(parsed.saleIds) ? parsed.saleIds.filter((id): id is string => typeof id === 'string') : undefined,
        }
      }
    } catch {
      return { globalBefore: value }
    }
    return { globalBefore: value }
  }
  if (value && typeof value === 'object') {
    const marker = value as { globalBefore?: unknown; purgeBefore?: unknown; saleIds?: unknown }
    const globalBefore = typeof marker.globalBefore === 'string'
      ? marker.globalBefore
      : typeof marker.purgeBefore === 'string' && (!Array.isArray(marker.saleIds) || marker.saleIds.length === 0)
        ? marker.purgeBefore
        : undefined
    return {
      globalBefore,
      saleIds: Array.isArray(marker.saleIds) ? marker.saleIds.filter((id): id is string => typeof id === 'string') : undefined,
    }
  }
  return undefined
}

async function getLocalSalesPurgeMarker() {
  const setting = await db.settings.get(SALES_PURGE_MARKER_KEY)
  return readSalesPurgeMarkerValue(setting?.value)
}

export async function applyLocalSalesPurge(
  purgeBefore: string,
  persistMarker = true,
  saleIds?: string[],
  globalBefore?: string,
) {
  const globalCutoffText = globalBefore || (saleIds?.length ? undefined : purgeBefore)
  const cutoff = globalCutoffText ? Date.parse(globalCutoffText) : NaN
  if (globalCutoffText && !Number.isFinite(cutoff)) throw new Error('La fecha de purga de ventas no es válida.')

  let counts = { sales: 0, history: 0, audit: 0, backups: 0, closures: 0 }
  const now = stamp()

  await db.transaction('rw', [db.sales, db.auditEvents, db.historyRecords, db.backups, db.closures, db.syncQueue, db.settings], async () => {
    const [sales, histories, auditEvents, backups, closures, queue] = await Promise.all([
      db.sales.toArray(), db.historyRecords.toArray(), db.auditEvents.toArray(), db.backups.toArray(), db.closures.toArray(), db.syncQueue.toArray(),
    ])

    const targetedIds = new Set((saleIds || []).map(String))
    const idsToDelete = sales
      .filter(sale => targetedIds.size
        ? targetedIds.has(String(sale.id))
        : Number.isFinite(cutoff) && (Date.parse(String(sale.createdAt || sale.updatedAt || '')) || 0) <= cutoff
      )
      .map(sale => String(sale.id))

    const deletedSaleIds = new Set(idsToDelete)
    if (deletedSaleIds.size) {
      counts.sales = deletedSaleIds.size
      await db.sales.bulkDelete(idsToDelete)
    }

    const historyIds = histories
      .filter(history => history.entity === 'sale' && (
        deletedSaleIds.has(history.recordId) || (!targetedIds.size && Number.isFinite(cutoff) && (Date.parse(String(history.capturedAt || '')) || 0) <= cutoff)
      ))
      .map(history => history.id)
    if (historyIds.length) {
      counts.history = historyIds.length
      await db.historyRecords.bulkDelete(historyIds)
    }

    const auditIds = auditEvents
      .filter(event => event.recordType === 'sale' && (
        deletedSaleIds.has(String(event.recordId || '')) || (!targetedIds.size && Number.isFinite(cutoff) && (Date.parse(String(event.timestamp || '')) || 0) <= cutoff)
      ))
      .map(event => event.id)
    if (auditIds.length) {
      counts.audit = auditIds.length
      await db.auditEvents.bulkDelete(auditIds)
    }

    // Scrub every local backup copy that can still carry the deleted invoice:
    // top-level sales, sale history, sale audit events and the embedded sales
    // list inside cash-closure snapshots. This prevents a later restore/export
    // from resurrecting the invoice.
    for (const backup of backups) {
      const payload = { ...(backup.payload || {}) } as Record<string, unknown>
      const hasBackupCollections = ['sales', 'history', 'events', 'closures'].some(key => Object.prototype.hasOwnProperty.call(payload, key))
      if (!hasBackupCollections || !deletedSaleIds.size) continue

      const backupSales = Array.isArray(payload.sales) ? payload.sales : []
      const remainingSales = backupSales.filter(item => !item || typeof item !== 'object' || !deletedSaleIds.has(String((item as Record<string, unknown>).id || '')))

      const backupHistory = Array.isArray(payload.history) ? payload.history : []
      const remainingHistory = backupHistory.filter(item => {
        if (!item || typeof item !== 'object') return true
        const row = item as Record<string, unknown>
        return !(String(row.entity || '') === 'sale' && deletedSaleIds.has(String(row.recordId || '')))
      })

      const backupEvents = Array.isArray(payload.events) ? payload.events : []
      const remainingEvents = backupEvents.filter(item => {
        if (!item || typeof item !== 'object') return true
        const row = item as Record<string, unknown>
        return !(String(row.recordType || '') === 'sale' && deletedSaleIds.has(String(row.recordId || '')))
      })

      const backupClosures = Array.isArray(payload.closures)
        ? payload.closures.map(item => {
            if (!item || typeof item !== 'object') return item
            const row = item as Record<string, unknown>
            if (!Array.isArray(row.sales)) return item
            return {
              ...row,
              sales: row.sales.filter(sale => !sale || typeof sale !== 'object' || !deletedSaleIds.has(String((sale as Record<string, unknown>).id || ''))),
            }
          })
        : []

      payload.sales = remainingSales
      payload.history = remainingHistory
      payload.events = remainingEvents
      payload.closures = backupClosures

      await db.backups.put({
        ...backup,
        payload,
        contents: {
          ...backup.contents,
          sales: remainingSales.length,
          history: remainingHistory.length,
          audit: remainingEvents.length,
        },
      })
      counts.backups += 1
    }

    for (const closure of closures) {
      if (!closure.sales?.length) continue
      const shouldTouch = targetedIds.size
        ? closure.sales.some(sale => targetedIds.has(String(sale.id)))
        : Number.isFinite(cutoff) && (Date.parse(String(closure.closedAt || '')) || 0) <= cutoff
      if (!shouldTouch) continue
      const remainingSales = targetedIds.size ? closure.sales.filter(sale => !targetedIds.has(String(sale.id))) : []
      await db.closures.put({ ...closure, sales: remainingSales, updatedAt: now })
      counts.closures += 1
    }

    const purgedIdList = [...deletedSaleIds]
    const queueReferencesPurgedSale = (operation: typeof queue[number]) => {
      if (!purgedIdList.length) return false
      if (operation.entity === 'sales' && operation.recordId && deletedSaleIds.has(String(operation.recordId))) return true
      if (!['audit_events', 'history_records', 'backups', 'cash_closures'].includes(String(operation.entity))) return false
      try {
        const serialized = JSON.stringify(operation.payload ?? {}) || ''
        return purgedIdList.some(id => serialized.includes(`\"${id}\"`)) || purgedIdList.some(id => serialized.includes(id))
      } catch {
        return false
      }
    }

    const staleQueueIds = queue
      .filter(operation => {
        if (operation.entity === 'system' && operation.operation === 'purge_sales') return false
        if (queueReferencesPurgedSale(operation)) return true
        if (!targetedIds.size && ['audit_events', 'history_records', 'backups', 'cash_closures'].includes(String(operation.entity))) {
          return Number.isFinite(cutoff) && (Date.parse(String(operation.createdAt || '')) || 0) <= cutoff
        }
        return false
      })
      .map(operation => operation.id)
    if (staleQueueIds.length) await db.syncQueue.bulkDelete(staleQueueIds)

    if (persistMarker) {
      const existing = await getLocalSalesPurgeMarker()
      const nextGlobalBefore = globalCutoffText || existing?.globalBefore
      const nextIds = new Set([...(existing?.saleIds || []), ...targetedIds])
      // A global purge subsumes all previous individual IDs, so keep only the
      // IDs added after that cutoff. Existing local markers are harmlessly kept.
      await db.settings.put({
        id: SALES_PURGE_MARKER_KEY,
        key: SALES_PURGE_MARKER_KEY,
        value: JSON.stringify({ globalBefore: nextGlobalBefore, saleIds: [...nextIds] }),
        updatedAt: now,
      })
    }
  })

  emitSyncChange()
  return counts
}

async function applyRemoteSalesPurgeMarker() {
  const marker = await getLocalSalesPurgeMarker()
  if (!marker?.globalBefore && !marker?.saleIds?.length) return false
  const effectiveBefore = marker.globalBefore || stamp()
  await applyLocalSalesPurge(effectiveBefore, false, marker.saleIds, marker.globalBefore)
  return true
}

export async function hasPendingSalesPurge() {
  return db.syncQueue
    .filter(operation => operation.entity === 'system' && operation.operation === 'purge_sales')
    .count()
    .then(count => count > 0)
}

export async function purgeRemoteSales(purgeBefore: string, saleIds?: string[]) {
  if (!supabaseConfigured || !supabase) {
    return { ok: false, offline: false as const, error: 'Supabase no está configurado.' }
  }
  if (!navigator.onLine) {
    return { ok: false, offline: true as const }
  }
  try {
    const { data, error } = await supabase.rpc('streamlinx_purge_sales_data', {
      p_purge_before: purgeBefore,
      p_sale_ids: saleIds?.length ? saleIds : null,
      p_access_key: STREAMLINX_PURGE_ACCESS_KEY,
    })
    if (error) {
      // When the browser reports online, do NOT silently downgrade a failed
      // remote purge to a local-only deletion. Definitive deletion requires the
      // server to acknowledge it. Offline is represented only by navigator.onLine.
      return { ok: false, offline: false as const, error: error.message }
    }
    const counts = data && typeof data === 'object'
      ? Object.fromEntries(
          Object.entries(data)
            .filter(([, value]) => typeof value === 'number')
            .map(([key, value]) => [key, Number(value)])
        )
      : undefined
    const remaining = data && typeof data === 'object' && typeof (data as Record<string, unknown>).remainingSales === 'number'
      ? Number((data as Record<string, unknown>).remainingSales)
      : 0
    if (remaining > 0) {
      return { ok: false, offline: false as const, error: `Supabase no confirmó el borrado completo: quedaron ${remaining} ventas.` }
    }
    return { ok: true as const, counts }
  } catch (error) {
    // Do not treat a transport failure as a successful offline fallback while
    // the browser says it is online. A definitive purge must reach Supabase.
    if (!navigator.onLine) return { ok: false, offline: true as const, error: cleanError(error) }
    return { ok: false, offline: false as const, error: cleanError(error) }
  }
}

export async function ensureRemoteSession() {
  if (!supabaseConfigured || !supabase || !navigator.onLine) return false
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session) return true

    // Offline login uses the durable local profile as the credential cache.
    // When connectivity comes back we establish the real Supabase session
    // automatically so the outbox can drain without forcing a second login.
    const { getSessionUser } = await import('./auth')
    const local = getSessionUser()
    if (!local?.authEmail || !/^\d{4}$/.test(local.pin)) return false
    const result = await supabase.auth.signInWithPassword({
      email: local.authEmail,
      password: `SmakyPOS#${local.pin}`,
    })
    if (result.error || !result.data.user) {
      lastError = result.error?.message || 'No fue posible restaurar la sesión Supabase.'
      return false
    }
    return true
  } catch (error) {
    lastError = cleanError(error)
    return false
  }
}

export async function getRemotePosVirginResetAt(): Promise<string | undefined> {
  if (!supabaseConfigured || !supabase || !navigator.onLine) return undefined
  try {
    const { data, error } = await supabase.rpc('streamlinx_get_pos_reset_state', {
      p_access_key: STREAMLINX_PURGE_ACCESS_KEY,
    })
    if (error) return undefined
    const resetAt = data && typeof data === 'object' ? (data as Record<string, unknown>).resetAt : undefined
    return typeof resetAt === 'string' ? resetAt : undefined
  } catch {
    return undefined
  }
}

function resettableTimestamp(entity: string, row: any): string {
  if (entity === 'cash_closures') return String(row.closedAt || row.updatedAt || '')
  if (entity === 'audit_events') return String(row.timestamp || '')
  if (entity === 'history_records') return String(row.capturedAt || '')
  if (entity === 'backups') return String(row.createdAt || '')
  return String(row.createdAt || row.updatedAt || '')
}

export async function applyRemotePosVirginResetState(resetAt?: string) {
  const remoteResetAt = resetAt || await getRemotePosVirginResetAt()
  if (!remoteResetAt) return false
  const remoteMs = Date.parse(remoteResetAt)
  if (!Number.isFinite(remoteMs)) return false

  const previous = await db.syncMeta.get(POS_VIRGIN_RESET_META_KEY)
  const previousMs = previous?.value ? Date.parse(String(previous.value)) : NaN
  if (Number.isFinite(previousMs) && previousMs >= remoteMs) return false

  await db.transaction(
    'rw',
    [db.sales, db.orders, db.customers, db.closures, db.auditEvents, db.historyRecords, db.backups, db.users, db.syncQueue, db.syncMeta],
    async () => {
      const [sales, orders, customers, closures, auditEvents, historyRecords, backups, users, queue] = await Promise.all([
        db.sales.toArray(),
        db.orders.toArray(),
        db.customers.toArray(),
        db.closures.toArray(),
        db.auditEvents.toArray(),
        db.historyRecords.toArray(),
        db.backups.toArray(),
        db.users.toArray(),
        db.syncQueue.toArray(),
      ])

      const resetEntity = (entity: string, rows: any[]) => rows
        .filter(row => Date.parse(resettableTimestamp(entity, row)) <= remoteMs)
        .map(row => String(row.id))

      const ids = {
        sales: resetEntity('sales', sales),
        orders: resetEntity('orders', orders),
        customers: resetEntity('customers', customers),
        cash_closures: resetEntity('cash_closures', closures),
        audit_events: resetEntity('audit_events', auditEvents),
        history_records: resetEntity('history_records', historyRecords),
        backups: resetEntity('backups', backups),
      }

      await Promise.all([
        db.sales.bulkDelete(ids.sales),
        db.orders.bulkDelete(ids.orders),
        db.customers.bulkDelete(ids.customers),
        db.closures.bulkDelete(ids.cash_closures),
        db.auditEvents.bulkDelete(ids.audit_events),
        db.historyRecords.bulkDelete(ids.history_records),
        db.backups.bulkDelete(ids.backups),
      ])

      const nonManagerUserIds = users
        .filter(user => user.role !== 'manager' && Date.parse(String(user.updatedAt || '')) <= remoteMs)
        .map(user => user.id)
      if (nonManagerUserIds.length) await db.users.bulkDelete(nonManagerUserIds)

      const resetEntities = new Set(['sales','orders','customers','cash_closures','audit_events','history_records','backups','users','system'])
      const staleQueueIds = queue
        .filter(operation => resetEntities.has(String(operation.entity)) && Date.parse(String(operation.createdAt || '')) <= remoteMs)
        .map(operation => operation.id)
      if (staleQueueIds.length) await db.syncQueue.bulkDelete(staleQueueIds)

      await db.syncMeta.put({
        id: POS_VIRGIN_RESET_META_KEY,
        value: remoteResetAt,
        updatedAt: stamp(),
      })
    }
  )

  emitSyncChange()
  return true
}

export async function purgePosToVirgin(): Promise<{ ok: boolean; error?: string; counts?: Record<string, number> }> {
  if (!supabaseConfigured || !supabase) return { ok: false, error: 'Supabase no está configurado.' }
  if (!navigator.onLine) return { ok: false, error: 'Para dejar el POS virgen en todos los dispositivos necesitas conexión a Supabase.' }

  try {
    const { data, error } = await supabase.rpc('streamlinx_reset_pos_to_virgin', {
      // The StreamLinx gate itself is the authorization for this destructive
      // operation; the server accepts the PIN and its legacy digest.
      p_access_key: STREAMLINX_RESET_RPC_ACCESS_KEY,
      p_reset_at: stamp(),
    })
    if (error) return { ok: false, error: error.message }

    const remoteCounts = data && typeof data === 'object'
      ? Object.fromEntries(
          Object.entries(data)
            .filter(([, value]) => typeof value === 'number')
            .map(([key, value]) => [key, Number(value)])
        )
      : undefined
    const resetAt = data && typeof data === 'object' ? String((data as Record<string, unknown>).resetAt || '') : ''
    if (!resetAt) return { ok: false, error: 'Supabase no devolvió la confirmación del reinicio global.' }

    await applyRemotePosVirginResetState(resetAt)

    // On the device that launched the reset, remove all operational records
    // older than the confirmed server reset and every stale queue operation.
    await db.syncQueue.where('entity').anyOf(['sales','orders','customers','cash_closures','audit_events','history_records','backups','system']).delete()
    await db.syncQueue.where('entity').equals('users').delete()

    const manager = (await db.users.toArray()).find(user => user.role === 'manager')
    const allUsers = await db.users.toArray()
    const removeUserIds = allUsers.filter(user => user.role !== 'manager').map(user => user.id)
    if (removeUserIds.length) await db.users.bulkDelete(removeUserIds)

    if (!manager) return { ok: false, error: 'Supabase terminó el reinicio, pero no quedó disponible el perfil Gerente local. Vuelve a iniciar sesión para recuperarlo.' }

    emitSyncChange()
    return { ok: true, counts: remoteCounts }
  } catch (error) {
    return { ok: false, error: cleanError(error) }
  }
}

export async function resetRemoteData(): Promise<{ ok: true; counts?: Record<string, number> } | { ok: false; offline: boolean; error?: string }> {
  if (!supabaseConfigured || !supabase || !navigator.onLine) return { ok: false, offline: true }
  try {
    if (!(await ensureRemoteSession())) {
      return { ok: false, offline: isNetworkError(lastError), error: lastError || 'No hay una sesión remota activa.' }
    }

    // Antes de ejecutar un reset remoto, vaciamos la outbox posible para que
    // operaciones antiguas no vuelvan a crear datos justo después del reset.
    await flushQueue()

    const { data, error } = await supabase.rpc('reset_test_data')
    if (error) {
      if (isNetworkError(error)) return { ok: false, offline: true, error: error.message }
      return { ok: false, offline: false, error: error.message }
    }
    const counts = data && typeof data === 'object'
      ? Object.fromEntries(Object.entries(data).filter(([, value]) => typeof value === 'number').map(([key, value]) => [key, Number(value)]))
      : undefined
    return { ok: true, counts }
  } catch (error) {
    return isNetworkError(error)
      ? { ok: false, offline: true, error: cleanError(error) }
      : { ok: false, offline: false, error: cleanError(error) }
  }
}

async function refreshRemoteSettings() {
  if (!supabase || !supabaseConfigured || !navigator.onLine || syncRunning) return

  // Toma el cerrojo antes de esperar la sesión para no solaparse con otro ciclo.
  syncRunning = true
  lastError = undefined
  emitSyncChange()
  try {
    if (!(await ensureRemoteSession())) return
    const { data, error } = await supabase.from('settings').select('*').order('id')
    if (error) throw error
    const rows = (data || []) as any[]
    const queue = await db.syncQueue.toArray()
    const pendingIds = new Set(queue
      .filter(operation => operation.entity === 'settings' && operation.operation === 'upsert' && operation.recordId)
      .map(operation => String(operation.recordId)))

    // Solo se aplica una fila remota si no hay una edición local pendiente. Las
    // escrituras pendientes se resuelven en syncNow/flushQueue con una consulta
    // de conflicto antes de enviarse.
    for (const row of rows) {
      const id = String(row.id)
      if (pendingIds.has(id)) continue
      await putLocalRemote('settings', row)
    }
    lastSyncedAt = stamp()
  } catch (error) {
    lastError = cleanError(error)
  } finally {
    syncRunning = false
    emitSyncChange()
  }
}

export async function syncNow(): Promise<SyncResult> {
  if (syncRunning) {
    // Si apareció una escritura durante otro ciclo, no perdemos la solicitud:
    // programa otra pasada cuando se libere el cerrojo.
    if (navigator.onLine && scheduledSyncTimer === null && typeof window !== 'undefined') {
      scheduledSyncTimer = window.setTimeout(() => {
        scheduledSyncTimer = null
        void syncNow()
      }, 1_000)
    }
    return { ...(await getSyncState()), ok: !lastError }
  }
  if (!supabaseConfigured || !supabase) return { ...(await getSyncState()), ok: false }
  if (!navigator.onLine) return { ...(await getSyncState()), ok: false }

  // El cerrojo se toma ANTES de cualquier await remoto. De otro modo, dos
  // solicitudes simultáneas podían empezar a subir la misma outbox a la vez.
  syncRunning = true
  lastError = undefined
  emitSyncChange()
  try {
    // StreamLinx tiene su propio marcador remoto y no depende de que el perfil
    // normal del POS esté abierto para limpiar las copias locales anteriores.
    await applyRemotePosVirginResetState()

    const localSalesPurgePending = await hasPendingSalesPurge()
    const localClosurePurgePending = await hasPendingCashClosurePurge()
    const localPurgePending = localSalesPurgePending || localClosurePurgePending
    const remoteSessionReady = await ensureRemoteSession()
    if (remoteSessionReady) startRealtimeSubscription()
    if (!remoteSessionReady && !localPurgePending) {
      schedulePendingQueueRetry()
      return { ...(await getSyncState()), ok: false }
    }

    // Una purga pendiente va primero. En los demás casos, limpiamos el estado
    // remoto antes de vaciar la outbox para evitar resurrecciones de datos.
    if (localPurgePending) {
      await flushQueue()
      if (!remoteSessionReady && !(await hasPendingSalesPurge()) && !(await hasPendingCashClosurePurge())) {
        await applyRemoteSalesPurgeMarker()
        lastSyncedAt = stamp()
        const state = await getSyncState()
        return { ...state, ok: state.pending === 0 && !state.lastError }
      }
    } else {
      await reconcileEntity('settings')
      await applyRemoteSalesPurgeMarker()
      await reconcileEntity('orders')
      await reconcileEntity('sales')
      await reconcileEntity('cash_closures')
      await flushQueue()
    }

    // Recoger de nuevo el marcador después de procesar cualquier purga remota.
    await reconcileEntity('settings')
    await applyRemoteSalesPurgeMarker()

    const entities: SyncEntity[] = ['settings', 'products', 'customers', 'orders', 'sales', 'cash_closures', 'audit_events', 'history_records', 'backups']
    for (const entity of entities) await reconcileEntity(entity)
    lastSyncedAt = stamp()
    const state = await getSyncState()
    clearPendingQueueRetryIfEmpty(state.pending)
    return { ...state, ok: state.pending === 0 && !state.lastError }
  } catch (error) {
    lastError = cleanError(error)
    return { ...(await getSyncState()), ok: false }
  } finally {
    syncRunning = false
    emitSyncChange()
    schedulePendingQueueRetry()
  }
}

/** Sync only the order queue and remote order list while the POS screen is open. */
export async function syncOrdersNow(): Promise<SyncResult> {
  if (syncRunning) return { ...(await getSyncState()), ok: false }
  if (!supabaseConfigured || !supabase || !navigator.onLine) return { ...(await getSyncState()), ok: false }

  // También protege este ciclo corto de pedidos contra solapamientos con el
  // sincronizador general y las actualizaciones de preferencias.
  syncRunning = true
  lastError = undefined
  emitSyncChange()
  try {
    const remoteSessionReady = await ensureRemoteSession()
    if (!remoteSessionReady) {
      schedulePendingQueueRetry()
      return { ...(await getSyncState()), ok: false }
    }
    startRealtimeSubscription()
    await applyRemotePosVirginResetState()
    await applyRemoteSalesPurgeMarker()
    // Primero intenta enviar todas las operaciones pendientes (incluido el
    // pedido guardado offline); después descarga el listado autoritativo.
    await flushQueue()
    await reconcileEntity('orders')
    lastSyncedAt = stamp()
    const state = await getSyncState()
    clearPendingQueueRetryIfEmpty(state.pending)
    return { ...state, ok: state.pending === 0 && !state.lastError }
  } catch (error) {
    lastError = cleanError(error)
    return { ...(await getSyncState()), ok: false }
  } finally {
    syncRunning = false
    emitSyncChange()
    schedulePendingQueueRetry()
  }
}

export async function syncAfterLogin() {
  await syncNow()
}

function scheduleRealtimeSync() {
  if (typeof window === 'undefined' || !navigator.onLine || !supabaseConfigured || !supabase) return
  if (liveSyncDebounceTimer !== null) window.clearTimeout(liveSyncDebounceTimer)
  liveSyncDebounceTimer = window.setTimeout(() => {
    liveSyncDebounceTimer = null
    if (document.visibilityState === 'visible' && navigator.onLine) void syncNow()
  }, 350)
}

/**
 * Listen for remote writes and reconcile local caches shortly afterwards.
 * The SQL migration adds these tables to supabase_realtime; a slow fallback
 * sync remains enabled to recover if a websocket notification is missed.
 */
function startRealtimeSubscription() {
  if (liveSyncChannel || !supabaseConfigured || !supabase) return
  const tables = [
    'settings', 'products', 'customers', 'orders', 'sales', 'cash_closures',
    'audit_events', 'history_records', 'backup_snapshots',
  ] as const
  let channel = supabase.channel('smaky-pos-live-sync')
  for (const table of tables) {
    channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      scheduleRealtimeSync()
    })
  }
  liveSyncChannel = channel
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') scheduleRealtimeSync()
  })
}

function scheduleRetry(force = false) {
  if (retryTimer !== null) window.clearTimeout(retryTimer)
  const now = Date.now()
  if (!force && now - lastAutomaticSyncRequest < 60_000) return
  lastAutomaticSyncRequest = now
  retryTimer = window.setTimeout(() => {
    retryTimer = null
    void syncNow()
  }, 1500)
}

export function startSync() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('online', () => { scheduleRetry(true) })
  window.addEventListener('offline', () => { emitSyncChange() })
  window.addEventListener('focus', () => { scheduleRetry(true) })
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRetry(true)
  })
  window.addEventListener('smaky-auth-change', () => { scheduleRetry(true) })
  // main.tsx emite este evento después de terminar seed(). Esto garantiza que
  // una recarga con el perfil ya iniciado también consulte Supabase al arrancar.
  window.addEventListener('smaky-data-ready', () => { scheduleRetry(true) })

  // The websocket normally propagates changes in well under a second. These
  // polling fallbacks recover missed notifications and still skip hidden/offline tabs.
  if (settingsPollingTimer === null) {
    settingsPollingTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refreshRemoteSettings()
    }, 30_000)
  }
  if (liveSyncFallbackTimer === null) {
    liveSyncFallbackTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void syncNow()
    }, 45_000)
  }
}

export const SYNC_CHANGE_EVENT = SYNC_EVENT
