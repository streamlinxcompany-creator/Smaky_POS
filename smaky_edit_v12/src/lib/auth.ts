import type { PermissionKey, Role, User } from './types'

const SESSION_KEY = 'smaky-session'

export const PERMISSION_DEFINITIONS: Array<{ key: PermissionKey; label: string; description: string; group: string }> = [
  { key: 'dashboard.view', label: 'Inicio', description: 'Ver el resumen y actividad del negocio.', group: 'Navegación' },
  { key: 'pos.access', label: 'Punto de venta', description: 'Registrar pedidos y realizar cobros.', group: 'Navegación' },
  { key: 'customers.manage', label: 'Clientes', description: 'Crear, buscar y administrar clientes.', group: 'Navegación' },
  { key: 'sales.view', label: 'Ver ventas', description: 'Consultar facturas y ventas registradas.', group: 'Ventas' },
  { key: 'sales.delete', label: 'Eliminar facturas', description: 'Eliminar ventas del historial con confirmación.', group: 'Ventas' },
  { key: 'products.manage', label: 'Productos', description: 'Crear, editar y administrar productos.', group: 'Catálogo' },
  { key: 'reports.view', label: 'Ver reportes', description: 'Consultar reportes y análisis de ventas.', group: 'Análisis' },
  { key: 'cashClosing.access', label: 'Cierre de caja', description: 'Preparar y realizar el cierre de caja.', group: 'Caja' },
]

const ALL_PERMISSION_KEYS = PERMISSION_DEFINITIONS.map(item => item.key)

export function defaultPermissionsForRole(role: Role): PermissionKey[] {
  if (role === 'manager') return [...ALL_PERMISSION_KEYS]
  if (role === 'admin') return [...ALL_PERMISSION_KEYS]
  return ['dashboard.view', 'pos.access', 'customers.manage', 'sales.view', 'cashClosing.access']
}

export function getUserPermissions(user: User): PermissionKey[] {
  if (user.role === 'manager') return [...ALL_PERMISSION_KEYS]
  const stored = Array.isArray(user.permissions) ? user.permissions : defaultPermissionsForRole(user.role)
  const clean = stored.filter((key): key is PermissionKey => ALL_PERMISSION_KEYS.includes(key))
  // El POS nunca puede quedar bloqueado: es la base operativa del sistema.
  return Array.from(new Set([...clean, 'pos.access']))
}

export function hasPermission(user: User | null | undefined, key: PermissionKey): boolean {
  if (!user || !user.active) return false
  return getUserPermissions(user).includes(key)
}

export function getSessionUser(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) as User : null
  } catch {
    return null
  }
}

export function setSessionUser(user: User) {
  const normalized = { ...user, permissions: getUserPermissions(user) }
  localStorage.setItem(SESSION_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new Event('smaky-auth-change'))
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
  window.dispatchEvent(new Event('smaky-auth-change'))
}

export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('') || 'S'
}
