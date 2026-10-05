import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''

const readKeyMap = (name: string): Record<string, string> => {
  try {
    return JSON.parse(Deno.env.get(name) || '{}') as Record<string, string>
  } catch {
    return {}
  }
}

const secretKeys = readKeyMap('SUPABASE_SECRET_KEYS')
const publishableKeys = readKeyMap('SUPABASE_PUBLISHABLE_KEYS')

const serviceRoleKey =
  secretKeys.default ||
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  ''

const publishableKey =
  publishableKeys.default ||
  Deno.env.get('SUPABASE_ANON_KEY') ||
  Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ||
  ''

if (!supabaseUrl || !serviceRoleKey || !publishableKey) {
  throw new Error('Faltan variables de Supabase para ejecutar admin-users.')
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const publicClient = createClient(supabaseUrl, publishableKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const pinPassword = (pin: string) => `SmakyPOS#${pin}`
const cleanName = (value: unknown) =>
  String(value ?? '').trim().replace(/\s+/g, ' ')
const validPin = (value: unknown) => /^\d{4}$/.test(String(value ?? ''))

const PROFILE_SELECT =
  'id, name, role, rank, active, permissions, auth_email, legacy_id'

type ProfileRow = {
  id: string
  name: string
  role: string
  rank: string
  active: boolean
  permissions: string[]
  auth_email: string
  legacy_id: string | null
}

const profileResponse = (profile: ProfileRow) => ({
  id: profile.id,
  name: profile.name,
  role: profile.role,
  rank: profile.rank,
  active: profile.active,
  permissions: profile.permissions,
  authEmail: profile.auth_email,
  legacyId: profile.legacy_id || undefined,
})

async function saveProfile(profile: {
  id: string
  name: string
  role: 'employee' | 'admin'
  rank: string
  active: boolean
  permissions: string[]
  legacyId: string
  authEmail: string
}) {
  const { data, error } = await admin
    .from('profiles')
    .upsert(
      {
        id: profile.id,
        name: profile.name,
        role: profile.role,
        rank: profile.rank,
        active: profile.active,
        permissions: profile.permissions,
        legacy_id: profile.legacyId,
        auth_email: profile.authEmail,
      },
      { onConflict: 'id' }
    )
    .select(PROFILE_SELECT)
    .maybeSingle()

  if (error) {
    console.error('Smaky saveProfile error:', error)
    throw new Error(error.message)
  }

  if (!data) {
    throw new Error('Supabase no devolvió el perfil recién creado.')
  }

  return data as ProfileRow
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (request.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405)
  }

  try {
    const authorization = request.headers.get('Authorization') || ''
    const token = authorization.replace(/^Bearer\s+/i, '').trim()

    if (!token) {
      return json({ error: 'Sesión no autenticada.' }, 401)
    }

    const { data: authData, error: authError } =
      await publicClient.auth.getUser(token)

    if (authError || !authData.user) {
      console.error('Smaky auth validation error:', authError)
      return json({ error: 'Sesión no válida.' }, 401)
    }

    const actorId = authData.user.id

    const { data: actor, error: actorError } = await admin
      .from('profiles')
      .select('id, name, role, active')
      .eq('id', actorId)
      .maybeSingle()

    if (actorError) {
      console.error('Smaky actor profile error:', actorError)
      return json({ error: actorError.message }, 500)
    }

    if (!actor?.active) {
      return json({ error: 'Perfil no autorizado.' }, 403)
    }

    let body: Record<string, unknown>

    try {
      body = await request.json() as Record<string, unknown>
    } catch {
      return json({ error: 'Solicitud inválida.' }, 400)
    }

    const action = String(body.action || '')

    if (action === 'provision') {
      if (actor.role !== 'manager') {
        return json(
          { error: 'Solo el gerente puede migrar perfiles locales.' },
          403
        )
      }

      const legacyId = String(body.legacyId || '').trim()
      const name = cleanName(body.name)
      const rank = cleanName(body.rank)
      const pin = String(body.pin || '')
      const role = String(body.role || 'employee') as
        | 'employee'
        | 'admin'

      const allowedPermissions = [
        'dashboard.view',
        'pos.access',
        'customers.manage',
        'customers.export',
        'sales.view',
        'sales.delete',
        'products.manage',
        'reports.view',
        'cashClosing.access',
      ]

      const permissions = Array.from(
        new Set(
          (Array.isArray(body.permissions) ? body.permissions : [])
            .map(String)
            .filter(item => allowedPermissions.includes(item))
            .concat(['pos.access'])
        )
      )

      if (
        !/^[A-Za-z0-9_-]{1,80}$/.test(legacyId) ||
        name.length < 2 ||
        rank.length < 2 ||
        !validPin(pin) ||
        !['admin', 'employee'].includes(role)
      ) {
        return json({ error: 'Datos del perfil local inválidos.' }, 400)
      }

      const { data: existingProfile, error: existingError } = await admin
        .from('profiles')
        .select(PROFILE_SELECT)
        .eq('legacy_id', legacyId)
        .maybeSingle()

      if (existingError) {
        return json({ error: existingError.message }, 500)
      }

      if (existingProfile) {
        const { error: passwordError } =
          await admin.auth.admin.updateUserById(
            existingProfile.id,
            { password: pinPassword(pin) }
          )

        if (passwordError) {
          return json({ error: passwordError.message }, 400)
        }

        const updatedExisting = await saveProfile({
          id: existingProfile.id,
          name,
          role,
          rank,
          active: true,
          permissions,
          legacyId,
          authEmail:
            existingProfile.auth_email ||
            `${legacyId}@smaky.local`,
        })

        return json(profileResponse(updatedExisting))
      }

      const email = `${legacyId}@smaky.local`

      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          password: pinPassword(pin),
          email_confirm: true,
          user_metadata: {
            smaky_legacy_id: legacyId,
            smaky_role: role,
            smaky_name: name,
            smaky_rank: rank,
            smaky_permissions: permissions,
          },
          app_metadata: {
            smaky_provisioned: true,
          },
        })

      if (createError || !created.user) {
        console.error('Smaky provision createUser error:', createError)
        return json(
          {
            error:
              createError?.message ||
              'No fue posible migrar el usuario.',
          },
          400
        )
      }

      try {
        const profile = await saveProfile({
          id: created.user.id,
          name,
          role,
          rank,
          active: true,
          permissions,
          legacyId,
          authEmail: email,
        })

        return json(profileResponse(profile))
      } catch (error) {
        await admin.auth.admin.deleteUser(created.user.id)
        const message =
          error instanceof Error
            ? error.message
            : 'No fue posible completar el perfil.'
        return json({ error: message }, 500)
      }
    }

    if (action === 'create') {
      if (actor.role !== 'manager') {
        return json(
          { error: 'Solo el gerente puede crear perfiles.' },
          403
        )
      }

      const name = cleanName(body.name)
      const rank = cleanName(body.rank)
      const pin = String(body.pin || '')

      if (name.length < 2 || rank.length < 2 || !validPin(pin)) {
        return json(
          { error: 'Datos de trabajador inválidos.' },
          400
        )
      }

      const legacyId = crypto.randomUUID()
      const email = `${legacyId}@smaky.local`
      const permissions = [
        'dashboard.view',
        'pos.access',
        'sales.view',
        'cashClosing.access',
      ]

      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          password: pinPassword(pin),
          email_confirm: true,
          user_metadata: {
            smaky_legacy_id: legacyId,
            smaky_role: 'employee',
            smaky_name: name,
            smaky_rank: rank,
            smaky_permissions: permissions,
          },
          app_metadata: {
            smaky_provisioned: true,
          },
        })

      if (createError || !created.user) {
        console.error('Smaky createUser error:', createError)
        return json(
          {
            error:
              createError?.message ||
              'No fue posible crear la cuenta.',
          },
          400
        )
      }

      try {
        const profile = await saveProfile({
          id: created.user.id,
          name,
          role: 'employee',
          rank,
          active: true,
          permissions,
          legacyId,
          authEmail: email,
        })

        return json(profileResponse(profile))
      } catch (error) {
        await admin.auth.admin.deleteUser(created.user.id)

        const message =
          error instanceof Error
            ? error.message
            : 'La cuenta se creó, pero no se pudo completar el perfil.'

        return json({ error: message }, 500)
      }
    }

    if (action === 'update') {
      const targetId = String(body.targetId || '')

      if (!targetId) {
        return json(
          { error: 'Perfil objetivo no especificado.' },
          400
        )
      }

      const { data: target, error: targetError } = await admin
        .from('profiles')
        .select(PROFILE_SELECT)
        .eq('id', targetId)
        .maybeSingle()

      if (targetError) {
        return json({ error: targetError.message }, 500)
      }

      if (!target) {
        return json({ error: 'No encontramos el perfil.' }, 404)
      }

      const changes =
        body.changes && typeof body.changes === 'object'
          ? body.changes as Record<string, unknown>
          : {}

      const wantsRoleChange =
        changes.role !== undefined &&
        changes.role !== target.role

      const wantsActiveChange =
        changes.active !== undefined &&
        changes.active !== target.active

      if (target.role === 'manager') {
        if (
          target.id !== actorId ||
          wantsRoleChange ||
          wantsActiveChange
        ) {
          return json(
            {
              error:
                'El gerente principal no puede ser degradado ni desactivado.',
            },
            403
          )
        }
      }

      if (wantsRoleChange && actor.role !== 'manager') {
        return json(
          { error: 'Solo el gerente puede cambiar roles.' },
          403
        )
      }

      if (
        changes.role !== undefined &&
        !['admin', 'employee', 'manager'].includes(
          String(changes.role)
        )
      ) {
        return json({ error: 'Rol inválido.' }, 400)
      }

      if (
        String(changes.role || target.role) === 'manager' &&
        target.role !== 'manager'
      ) {
        return json(
          { error: 'No se pueden crear más perfiles gerente.' },
          403
        )
      }

      if (
        wantsActiveChange &&
        target.role === 'admin' &&
        actor.role !== 'manager'
      ) {
        return json(
          {
            error:
              'Solo el gerente puede desactivar administradores.',
          },
          403
        )
      }

      if (target.id === actorId && wantsActiveChange) {
        return json(
          { error: 'No puedes desactivar tu propia sesión.' },
          403
        )
      }

      if (target.role === 'manager') {
        return json(
          { error: 'El gerente principal no admite ese cambio.' },
          403
        )
      }

      const profileUpdate: Record<string, unknown> = {}

      if (
        typeof changes.name === 'string' &&
        cleanName(changes.name).length >= 2
      ) {
        profileUpdate.name = cleanName(changes.name)
      }

      if (
        typeof changes.rank === 'string' &&
        cleanName(changes.rank).length >= 2
      ) {
        profileUpdate.rank = cleanName(changes.rank)
      }

      if (typeof changes.active === 'boolean') {
        profileUpdate.active = changes.active
      }

      if (wantsRoleChange) {
        profileUpdate.role = String(changes.role)
      }

      if (
        actor.role === 'manager' &&
        Array.isArray(changes.permissions)
      ) {
        const allowed = [
          'dashboard.view',
          'pos.access',
          'customers.manage',
          'customers.export',
          'sales.view',
          'sales.delete',
          'products.manage',
          'reports.view',
          'cashClosing.access',
        ]

        profileUpdate.permissions = Array.from(
          new Set(
            changes.permissions
              .map(String)
              .filter(item => allowed.includes(item))
              .concat(['pos.access'])
          )
        )
      }

      if (typeof changes.pin === 'string' && changes.pin) {
        if (!validPin(changes.pin)) {
          return json(
            { error: 'El PIN debe tener 4 números.' },
            400
          )
        }

        const { error: passwordError } =
          await admin.auth.admin.updateUserById(
            targetId,
            { password: pinPassword(changes.pin) }
          )

        if (passwordError) {
          return json({ error: passwordError.message }, 400)
        }
      }

      if (Object.keys(profileUpdate).length === 0) {
        const current = target as ProfileRow
        return json(profileResponse(current))
      }

      const { data: updated, error: updateError } = await admin
        .from('profiles')
        .update(profileUpdate)
        .eq('id', targetId)
        .select(PROFILE_SELECT)
        .maybeSingle()

      if (updateError) {
        return json({ error: updateError.message }, 400)
      }

      if (!updated) {
        return json(
          { error: 'No fue posible actualizar el perfil.' },
          400
        )
      }

      return json(profileResponse(updated as ProfileRow))
    }

    if (action === 'delete') {
      if (actor.role !== 'manager') {
        return json(
          { error: 'Solo el gerente puede eliminar perfiles.' },
          403
        )
      }

      const targetId = String(body.targetId || '')

      if (!targetId || targetId === actorId) {
        return json({ error: 'Perfil no válido.' }, 400)
      }

      const { data: target, error: targetError } = await admin
        .from('profiles')
        .select('id, role')
        .eq('id', targetId)
        .maybeSingle()

      if (targetError) {
        return json({ error: targetError.message }, 500)
      }

      if (!target || target.role === 'manager') {
        return json(
          { error: 'Ese perfil no se puede eliminar.' },
          403
        )
      }

      const { error } =
        await admin.auth.admin.deleteUser(targetId)

      if (error) {
        return json({ error: error.message }, 400)
      }

      return json({ ok: true })
    }

    return json({ error: 'Acción no reconocida.' }, 400)
  } catch (error) {
    console.error('Smaky admin-users unhandled error:', error)

    const message =
      error instanceof Error
        ? error.message
        : String(error)

    return json({ error: message }, 500)
  }
})
