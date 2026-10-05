import type { PermissionKey, Role, User } from './types'
import { db } from './db'
import { supabase, supabaseConfigured } from './supabase'
import { syncAfterLogin } from './sync'

const SESSION_KEY = 'smaky-session'
const DEFAULT_MANAGER_LEGACY_ID = 'u-owner'
const AUTH_DOMAIN = 'smaky.local'
const authPasswordFromPin = (pin: string) => `SmakyPOS#${pin}`

export const PERMISSION_DEFINITIONS: Array<{
  key: PermissionKey
  label: string
  description: string
  group: string
}> = [
  {
    key: 'dashboard.view',
    label: 'Inicio',
    description: 'Ver el resumen y actividad del negocio.',
    group: 'Navegación',
  },
  {
    key: 'pos.access',
    label: 'Punto de venta',
    description: 'Registrar pedidos y realizar cobros.',
    group: 'Navegación',
  },
  {
    key: 'customers.manage',
    label: 'Clientes',
    description: 'Crear, buscar y administrar clientes.',
    group: 'Navegación',
  },
  {
    key: 'customers.export',
    label: 'Exportar clientes',
    description: 'Exportar la base completa de clientes a un archivo compatible con Excel.',
    group: 'Clientes',
  },
  {
    key: 'sales.view',
    label: 'Ver ventas',
    description: 'Consultar facturas y ventas registradas.',
    group: 'Ventas',
  },
  {
    key: 'sales.delete',
    label: 'Eliminar facturas',
    description: 'Eliminar ventas del historial con confirmación.',
    group: 'Ventas',
  },
  {
    key: 'products.manage',
    label: 'Productos',
    description: 'Crear, editar y administrar productos.',
    group: 'Catálogo',
  },
  {
    key: 'reports.view',
    label: 'Ver reportes',
    description: 'Consultar reportes y análisis de ventas.',
    group: 'Análisis',
  },
  {
    key: 'cashClosing.access',
    label: 'Cierre de caja',
    description: 'Preparar y realizar el cierre de caja.',
    group: 'Caja',
  },
]

const ALL_PERMISSION_KEYS = PERMISSION_DEFINITIONS.map(item => item.key)

export function defaultPermissionsForRole(role: Role): PermissionKey[] {
  if (role === 'manager') return [...ALL_PERMISSION_KEYS]
  if (role === 'admin') return [...ALL_PERMISSION_KEYS]

  return [
    'dashboard.view',
    'pos.access',
    'customers.manage',
    'sales.view',
    'cashClosing.access',
  ]
}

export function getUserPermissions(user: User): PermissionKey[] {
  if (user.role === 'manager') return [...ALL_PERMISSION_KEYS]

  const stored = Array.isArray(user.permissions)
    ? user.permissions
    : defaultPermissionsForRole(user.role)

  const clean = stored.filter(
    (key): key is PermissionKey => ALL_PERMISSION_KEYS.includes(key)
  )

  return Array.from(new Set([...clean, 'pos.access']))
}

export function hasPermission(
  user: User | null | undefined,
  key: PermissionKey
): boolean {
  if (!user || !user.active) return false

  return getUserPermissions(user).includes(key)
}

export function getSessionUser(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)

    return raw
      ? JSON.parse(raw) as User
      : null
  } catch {
    return null
  }
}

export function setSessionUser(user: User) {
  const normalized = {
    ...user,
    permissions: getUserPermissions(user),
  }

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify(normalized)
  )

  window.dispatchEvent(
    new Event('smaky-auth-change')
  )
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)

  if (supabase) {
    void supabase.auth.signOut()
  }

  window.dispatchEvent(
    new Event('smaky-auth-change')
  )
}

export async function validateRemoteSession() {
  const local = getSessionUser()

  if (
    !local ||
    !supabaseConfigured ||
    !supabase
  ) {
    return
  }

  try {
    const { data, error } =
      await supabase.auth.getSession()

    if (error) {
      console.error(
        'Smaky: error comprobando sesión Supabase:',
        error
      )
      return
    }

    if (!data.session) {
      clearSession()
    }
  } catch (error) {
    console.error(
      'Smaky: no se pudo comprobar la sesión Supabase:',
      error
    )
  }
}

export type LoginProfile = {
  id: string
  name: string
  role: Role
  rank: string
  active: boolean
  authEmail: string
  legacyId?: string
}

export async function getLoginProfiles(
  activeOnly = true
): Promise<LoginProfile[]> {
  if (
    !supabaseConfigured ||
    !supabase
  ) {
    console.error(
      'Smaky: Supabase no está configurado.'
    )
    return []
  }

  if (!navigator.onLine) {
    console.warn(
      'Smaky: navegador sin conexión. No se pueden cargar perfiles remotos.'
    )
    return []
  }

  const {
    data,
    error,
  } = await supabase
    .from('pos_login_profiles')
    .select(
      'id, name, role, rank, active, auth_email, legacy_id'
    )
    .order('name')

  if (error) {
    console.error(
      'Smaky login profiles error:',
      error
    )

    return []
  }

  return ((data || []) as Record<string, unknown>[])
    .map(row => ({
      id: String(row.id),
      name: String(row.name || 'Usuario'),
      role: String(
        row.role || 'employee'
      ) as Role,
      rank: String(
        row.rank || 'Trabajador'
      ),
      active: Boolean(row.active),
      authEmail: String(
        row.auth_email || ''
      ),
      legacyId: row.legacy_id
        ? String(row.legacy_id)
        : undefined,
    }))
    .filter(
      item =>
        item.authEmail &&
        (!activeOnly || item.active)
    )
}

function localLogin(
  user: User,
  pin: string
): {
  user: User | null
  error?: string
} {
  if (!user.active) {
    return {
      user: null,
      error: 'Este perfil está desactivado.',
    }
  }

  if (pin !== user.pin) {
    return {
      user: null,
      error: 'PIN incorrecto.',
    }
  }

  setSessionUser(user)

  return { user }
}

export async function signInWithPin(
  user: User,
  pin: string
): Promise<{
  user: User | null
  error?: string
}> {
  if (!user.active) {
    return {
      user: null,
      error: 'Este perfil está desactivado.',
    }
  }

  /*
   * MODO OFFLINE:
   * Si realmente no hay Internet, permitimos
   * utilizar la cuenta local.
   */
  if (!navigator.onLine) {
    console.warn(
      'Smaky: navegador offline. Usando login local.'
    )

    return localLogin(user, pin)
  }

  /*
   * EN PRODUCCIÓN:
   * Si estamos online, Supabase DEBE estar configurado.
   */
  if (!supabaseConfigured || !supabase) {
    console.error(
      'Smaky: Supabase NO está configurado en esta versión publicada.'
    )

    return {
      user: null,
      error:
        'Supabase no está configurado en esta versión de Smaky. Haz un nuevo deploy en Cloudflare.',
    }
  }

  /*
   * El perfil debe tener el correo remoto.
   */
  if (!user.authEmail) {
    console.error(
      'Smaky: el perfil no tiene authEmail:',
      user
    )

    return {
      user: null,
      error:
        'Este usuario no tiene una cuenta de Supabase configurada.',
    }
  }

  console.log(
    'Smaky: intentando login Supabase...',
    {
      email: user.authEmail,
      supabaseConfigured,
      url: 'https://jipmbegkgxnlqthmbvpp.supabase.co',
    }
  )

  const {
    data,
    error,
  } = await supabase.auth.signInWithPassword({
    email: user.authEmail,
    password: authPasswordFromPin(pin),
  })

  /*
   * MUY IMPORTANTE:
   * Ya NO hacemos fallback silencioso a localLogin().
   */
  if (error || !data.user) {
    console.error(
      'Smaky Supabase login error:',
      error
    )

    return {
      user: null,
      error:
        error?.message ||
        'Supabase no pudo iniciar la sesión.',
    }
  }

  console.log(
    'Smaky: login Supabase exitoso:',
    data.user.id
  )

  /*
   * Obtener el perfil real desde Supabase.
   */
  const {
    data: profile,
    error: profileError,
  } = await supabase
    .from('profiles')
    .select(
      'id, name, role, rank, active, permissions, auth_email, legacy_id, updated_at'
    )
    .eq('id', data.user.id)
    .maybeSingle()

  if (profileError || !profile) {
    console.error(
      'Smaky: error leyendo profiles:',
      profileError
    )

    await supabase.auth.signOut()

    return {
      user: null,
      error:
        profileError?.message ||
        'La cuenta existe, pero no tiene un perfil Smaky POS configurado.',
    }
  }

  if (!profile.active) {
    await supabase.auth.signOut()

    return {
      user: null,
      error:
        'Este perfil está desactivado.',
    }
  }

  const permissions =
    Array.isArray(profile.permissions)
      ? profile.permissions as PermissionKey[]
      : getUserPermissions(user)

  const currentLocal =
    (await db.users.get(user.id)) ||
    (await db.users.get(data.user.id))

  const legacyId = String(
    profile?.legacy_id ||
      user.legacyId ||
      user.id ||
      DEFAULT_MANAGER_LEGACY_ID
  )

  const normalized: User = {
    ...(currentLocal || user),

    id: data.user.id,

    legacyId,

    authEmail: String(
      profile?.auth_email ||
        user.authEmail ||
        `${legacyId}@${AUTH_DOMAIN}`
    ),

    name: String(
      profile?.name ||
        user.name
    ),

    role: String(
      profile?.role ||
        user.role
    ) as Role,

    rank: String(
      profile?.rank ||
        user.rank ||
        'Trabajador'
    ),

    active:
      profile?.active !== false,

    permissions,

    pin,

    updatedAt: String(
      profile?.updated_at ||
        new Date().toISOString()
    ),
  }

  if (
    currentLocal &&
    currentLocal.id !== normalized.id
  ) {
    await db.users.delete(
      currentLocal.id
    )
  }

  await db.users.put(
    normalized
  )

  setSessionUser(
    normalized
  )

  /*
   * Migración de usuarios locales
   * y sincronización inicial.
   */
  try {
    await migrateLocalUsersToSupabase()
    await syncAfterLogin()

    console.log(
      'Smaky: sincronización inicial completada.'
    )
  } catch (error) {
    console.error(
      'Smaky: error durante la sincronización inicial:',
      error
    )
  }

  return {
    user: normalized,
  }
}

export async function provisionRemoteUser(
  user: User
) {
  if (
    !supabaseConfigured ||
    !supabase ||
    !navigator.onLine
  ) {
    return null
  }

  if (user.role === 'manager') {
    return null
  }

  if (!/^\d{4}$/.test(user.pin)) {
    return null
  }

  const legacyId =
    user.legacyId || user.id

  const {
    data,
    error,
  } = await supabase.functions.invoke(
    'admin-users',
    {
      body: {
        action: 'provision',
        legacyId,
        name: user.name,
        pin: user.pin,
        rank: user.rank,
        role: user.role,
        permissions:
          user.permissions ||
          defaultPermissionsForRole(
            user.role
          ),
      },
    }
  )

  if (error) {
    console.error(
      'Smaky provisionRemoteUser error:',
      error
    )

    throw new Error(
      error.message ||
      'No fue posible migrar el usuario a Supabase.'
    )
  }

  return data as {
    id: string
    name: string
    role: Role
    rank: string
    active: boolean
    permissions: PermissionKey[]
    authEmail: string
    legacyId?: string
  }
}

export async function migrateLocalUsersToSupabase() {
  if (
    !supabaseConfigured ||
    !supabase ||
    !navigator.onLine
  ) {
    return
  }

  const actor = getSessionUser()

  if (
    !actor ||
    actor.role !== 'manager' ||
    !actor.active
  ) {
    return
  }

  const locals =
    await db.users.toArray()

  for (const user of locals) {
    if (
      user.deletedAt ||
      user.role === 'manager' ||
      user.authEmail
    ) {
      continue
    }

    try {
      const remote =
        await provisionRemoteUser(
          user
        )

      if (!remote) continue

      const migrated: User = {
        ...user,

        id: remote.id,

        legacyId:
          remote.legacyId ||
          user.legacyId ||
          user.id,

        authEmail:
          remote.authEmail,

        name:
          remote.name,

        role:
          remote.role,

        rank:
          remote.rank,

        active:
          remote.active,

        permissions:
          remote.permissions,

        updatedAt:
          new Date().toISOString(),
      }

      await db.users.delete(
        user.id
      )

      await db.users.put(
        migrated
      )
    } catch (error) {
      console.warn(
        'Smaky: no se pudo migrar un usuario local todavía.',
        error
      )
    }
  }
}

export async function createRemoteWorker(
  name: string,
  pin: string,
  rank: string
) {
  if (
    !supabaseConfigured ||
    !supabase ||
    !navigator.onLine
  ) {
    throw new Error(
      'Supabase no está disponible o el navegador está sin conexión.'
    )
  }

  try {
    const {
      data,
      error,
    } = await supabase.functions.invoke(
      'admin-users',
      {
        body: {
          action: 'create',
          name: name.trim(),
          pin,
          rank: rank.trim(),
          role: 'employee',
        },
      }
    )

    if (error) {
      console.error(
        'Smaky admin-users error:',
        error
      )

      const context =
        (error as { context?: Response }).context

      if (context) {
        let responseText = ''

        try {
          responseText = await context.text()
        } catch (contextReadError) {
          console.error(
            'Smaky: no se pudo leer la respuesta de admin-users:',
            contextReadError
          )
        }

        if (responseText) {
          console.error(
            'Smaky admin-users response:',
            responseText
          )

          try {
            const parsed = JSON.parse(responseText) as {
              error?: string
              message?: string
              code?: string
            }

            const detailedMessage =
              parsed.error ||
              parsed.message ||
              (parsed.code
                ? `${parsed.code}: ${responseText}`
                : responseText)

            throw new Error(
              detailedMessage
            )
          } catch (parseError) {
            if (parseError instanceof Error) {
              throw parseError
            }

            throw new Error(
              responseText
            )
          }
        }
      }

      throw new Error(
        error.message ||
        'La Edge Function devolvió un error.'
      )
    }

    if (!data) {
      throw new Error(
        'La Edge Function respondió correctamente pero no devolvió datos.'
      )
    }

    console.log(
      'Smaky trabajador remoto creado:',
      data
    )

    return data as {
      id: string
      name: string
      role: Role
      rank: string
      active: boolean
      permissions: PermissionKey[]
      authEmail: string
      legacyId?: string
    }
  } catch (error) {
    console.error(
      'Smaky createRemoteWorker fatal:',
      error
    )

    throw error instanceof Error
      ? error
      : new Error(String(error))
  }
}

export async function updateRemoteUser(
  targetId: string,
  changes: Partial<User>
) {
  if (
    !supabaseConfigured ||
    !supabase ||
    !navigator.onLine
  ) {
    return null
  }

  const {
    data,
    error,
  } = await supabase.functions.invoke(
    'admin-users',
    {
      body: {
        action: 'update',
        targetId,
        changes,
      },
    }
  )

  if (error) {
    throw new Error(
      error.message ||
      'No fue posible actualizar la cuenta remota.'
    )
  }

  return data as {
    id: string
    name: string
    role: Role
    rank: string
    active: boolean
    permissions: PermissionKey[]
    authEmail: string
    legacyId?: string
  }
}

export async function deleteRemoteUser(
  targetId: string
) {
  if (
    !supabaseConfigured ||
    !supabase ||
    !navigator.onLine
  ) {
    return false
  }

  const {
    data,
    error,
  } = await supabase.functions.invoke(
    'admin-users',
    {
      body: {
        action: 'delete',
        targetId,
      },
    }
  )

  if (error) {
    throw new Error(
      error.message ||
      'No fue posible eliminar la cuenta remota.'
    )
  }

  return Boolean(
    (
      data as {
        ok?: boolean
      } | null
    )?.ok
  )
}

export function initials(
  name: string
) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(
        part =>
          part[0]?.toUpperCase() ?? ''
      )
      .join('') || 'S'
  )
}