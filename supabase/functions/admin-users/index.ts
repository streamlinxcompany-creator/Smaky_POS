import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''

// Supabase injects these key maps into hosted Edge Functions.
// New API keys are JSON objects keyed by name (normally `default`).
// Legacy variables are kept as fallbacks for older projects.
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
const cleanName = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ')
const validPin = (value: unknown) => /^\d{4}$/.test(String(value ?? ''))

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)

  const authorization = request.headers.get('Authorization') || ''
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!token) return json({ error: 'Sesión no autenticada.' }, 401)

  const { data: authData, error: authError } = await publicClient.auth.getUser(token)
  if (authError || !authData.user) return json({ error: 'Sesión no válida.' }, 401)

  const actorId = authData.user.id
  const { data: actor, error: actorError } = await admin
    .from('profiles')
    .select('id, name, role, active')
    .eq('id', actorId)
    .maybeSingle()
  if (actorError || !actor?.active) return json({ error: 'Perfil no autorizado.' }, 403)

  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { return json({ error: 'Solicitud inválida.' }, 400) }
  const action = String(body.action || '')
  const operationCreatedAt = String(body.operationCreatedAt || '')
  if (operationCreatedAt) {
    const { data: resetState } = await admin
      .from('streamlinx_pos_reset_state')
      .select('reset_at')
      .eq('id', true)
      .maybeSingle()
    if (resetState?.reset_at && Number.isFinite(Date.parse(operationCreatedAt)) && Date.parse(operationCreatedAt) <= Date.parse(String(resetState.reset_at))) {
      return json({ error: 'Operación de usuario anterior al último reinicio global del POS.', code: 'POS_RESET_STALE_OPERATION' }, 409)
    }
  }

  if (action === 'list') {
    if (actor.role !== 'manager') return json({ error: 'Solo el gerente puede consultar los PIN.' }, 403)

    const { data: profiles, error: profilesError } = await admin
      .from('profiles')
      .select('id, name, role, rank, active, permissions, auth_email, legacy_id, pin')
      .order('name')

    if (profilesError) return json({ error: profilesError.message }, 400)

    return json({
      profiles: (profiles || []).map(profile => ({
        id: profile.id,
        name: profile.name,
        role: profile.role,
        rank: profile.rank,
        active: profile.active,
        permissions: profile.permissions,
        authEmail: profile.auth_email,
        legacyId: profile.legacy_id,
        pin: profile.pin || '',
      })),
    })
  }

  if (action === 'get') {
    if (actor.role !== 'manager') return json({ error: 'Solo el gerente puede consultar la configuración de perfiles.' }, 403)
    const targetId = String(body.targetId || '')
    if (!targetId) return json({ error: 'Perfil objetivo no especificado.' }, 400)

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, name, role, rank, active, permissions, auth_email, legacy_id, pin')
      .eq('id', targetId)
      .maybeSingle()

    if (profileError || !profile) return json({ error: profileError?.message || 'No encontramos el perfil.' }, 404)

    return json({
      profile: {
        id: profile.id,
        name: profile.name,
        role: profile.role,
        rank: profile.rank,
        active: profile.active,
        permissions: profile.permissions,
        authEmail: profile.auth_email,
        legacyId: profile.legacy_id,
        pin: profile.pin || '',
      },
    })
  }

  if (action === 'provision') {
    if (actor.role !== 'manager') return json({ error: 'Solo el gerente puede migrar perfiles locales.' }, 403)
    const legacyId = String(body.legacyId || '').trim()
    const name = cleanName(body.name)
    const rank = cleanName(body.rank)
    const pin = String(body.pin || '')
    const role = String(body.role || 'employee')
    const allowedRoles = ['admin', 'employee']
    const allowedPermissions = ['dashboard.view','pos.access','customers.manage','customers.export','sales.view','sales.delete','products.manage','reports.view','cashClosing.access','settings.general','settings.orders','settings.payments','settings.categories','invoice.settings']
    const permissions = Array.from(new Set((Array.isArray(body.permissions) ? body.permissions : []).map(String).filter(item => allowedPermissions.includes(item))))
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(legacyId) || name.length < 2 || rank.length < 2 || !validPin(pin) || !allowedRoles.includes(role)) {
      return json({ error: 'Datos del perfil local inválidos.' }, 400)
    }

    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, name, role, rank, active, permissions, auth_email, legacy_id, pin')
      .eq('legacy_id', legacyId)
      .maybeSingle()
    if (existingProfile) {
      const { error: passwordError } = await admin.auth.admin.updateUserById(existingProfile.id, { password: pinPassword(pin) })
      if (passwordError) return json({ error: passwordError.message }, 400)
      const { data: updatedExisting, error: updateExistingError } = await admin
        .from('profiles')
        .update({ name, rank, role, active: true, permissions, pin })
        .eq('id', existingProfile.id)
        .select('id, name, role, rank, active, permissions, auth_email, legacy_id, pin')
        .maybeSingle()
      if (updateExistingError || !updatedExisting) return json({ error: updateExistingError?.message || 'No fue posible actualizar el perfil migrado.' }, 400)
      return json({
        id: updatedExisting.id,
        name: updatedExisting.name,
        role: updatedExisting.role,
        rank: updatedExisting.rank,
        active: updatedExisting.active,
        permissions: updatedExisting.permissions,
        authEmail: updatedExisting.auth_email,
        legacyId: updatedExisting.legacy_id,
        pin: updatedExisting.pin || pin,
      })
    }

    const email = `${legacyId}@smaky.local`
    const { data: created, error: createError } = await admin.auth.admin.createUser({
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
      app_metadata: { smaky_provisioned: true },
    })
    if (createError || !created.user) return json({ error: createError?.message || 'No fue posible migrar el usuario.' }, 400)

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: created.user.id,
        name,
        rank,
        role,
        active: true,
        permissions,
        pin,
        legacy_id: legacyId,
        auth_email: email,
      }, { onConflict: 'id' })
      .select('id, name, role, rank, active, permissions, auth_email, legacy_id, pin')
      .maybeSingle()
    if (profileError || !profile) {
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: profileError?.message || 'La cuenta se creó, pero no se pudo completar el perfil.' }, 500)
    }

    return json({
      id: profile.id,
      name: profile.name,
      role: profile.role,
      rank: profile.rank,
      active: profile.active,
      permissions: profile.permissions,
      authEmail: profile.auth_email,
      legacyId: profile.legacy_id,
      pin: profile.pin || pin,
    })
  }

  if (action === 'create') {
    if (actor.role !== 'manager') return json({ error: 'Solo el gerente puede crear perfiles.' }, 403)
    const name = cleanName(body.name)
    const rank = cleanName(body.rank)
    const pin = String(body.pin || '')
    const requestedLegacyId = String(body.legacyId || '').trim()
    if (name.length < 2 || rank.length < 2 || !validPin(pin)) return json({ error: 'Datos de trabajador inválidos.' }, 400)

    const legacyId = /^[A-Za-z0-9_-]{1,80}$/.test(requestedLegacyId)
      ? requestedLegacyId
      : crypto.randomUUID()

    // Idempotencia: si el mismo intento de creación llega dos veces,
    // reutilizamos el perfil existente en lugar de crear otra cuenta.
    const { data: existingProfile, error: existingError } = await admin
      .from('profiles')
      .select('id, name, role, rank, active, permissions, auth_email, legacy_id, pin')
      .eq('legacy_id', legacyId)
      .maybeSingle()

    if (existingError) {
      return json({ error: existingError.message }, 500)
    }

    if (existingProfile) {
      const { error: passwordError } = await admin.auth.admin.updateUserById(existingProfile.id, {
        password: pinPassword(pin),
      })

      if (passwordError) {
        return json({ error: passwordError.message }, 400)
      }

      const { data: updatedExisting, error: updateExistingError } = await admin
        .from('profiles')
        .upsert({
          id: existingProfile.id,
          name,
          role: 'employee',
          rank,
          active: true,
          permissions: ['dashboard.view', 'pos.access', 'sales.view', 'cashClosing.access'],
          legacy_id: legacyId,
          auth_email: existingProfile.auth_email || `${legacyId}@smaky.local`,
        }, { onConflict: 'id' })
        .select('id, name, role, rank, active, permissions, auth_email, legacy_id, pin')
        .maybeSingle()

      if (updateExistingError || !updatedExisting) {
        return json({ error: updateExistingError?.message || 'No fue posible reutilizar el perfil existente.' }, 500)
      }

      return json({
        id: updatedExisting.id,
        name: updatedExisting.name,
        role: updatedExisting.role,
        rank: updatedExisting.rank,
        active: updatedExisting.active,
        permissions: updatedExisting.permissions,
        authEmail: updatedExisting.auth_email,
        legacyId: updatedExisting.legacy_id,
        pin: updatedExisting.pin || pin,
      })
    }

    const email = `${legacyId}@smaky.local`
    const permissions = ['dashboard.view', 'pos.access', 'sales.view', 'cashClosing.access']
    const { data: created, error: createError } = await admin.auth.admin.createUser({
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
      app_metadata: { smaky_provisioned: true },
    })

    if (createError || !created.user) {
      // En una doble petición simultánea, la primera puede haber creado
      // la cuenta mientras la segunda recibe "already registered".
      // Recuperamos entonces el mismo perfil y devolvemos éxito.
      const { data: recoveredProfile } = await admin
        .from('profiles')
        .select('id, name, role, rank, active, permissions, auth_email, legacy_id, pin')
        .eq('legacy_id', legacyId)
        .maybeSingle()

      if (recoveredProfile) {
        const { error: recoveredPasswordError } = await admin.auth.admin.updateUserById(
          recoveredProfile.id,
          { password: pinPassword(pin) }
        )

        if (recoveredPasswordError) {
          return json({ error: recoveredPasswordError.message }, 400)
        }

        return json({
          id: recoveredProfile.id,
          name: recoveredProfile.name,
          role: recoveredProfile.role,
          rank: recoveredProfile.rank,
          active: recoveredProfile.active,
          permissions: recoveredProfile.permissions,
          authEmail: recoveredProfile.auth_email,
          legacyId: recoveredProfile.legacy_id,
        })
      }

      return json({ error: createError?.message || 'No fue posible crear la cuenta.' }, 400)
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: created.user.id,
        name,
        rank,
        role: 'employee',
        active: true,
        permissions,
        pin,
        legacy_id: legacyId,
        auth_email: email,
      }, { onConflict: 'id' })
      .select('id, name, role, rank, active, permissions, auth_email, legacy_id, pin')
      .maybeSingle()
    if (profileError || !profile) {
      await admin.auth.admin.deleteUser(created.user.id)
      return json({ error: profileError?.message || 'La cuenta se creó, pero no se pudo completar el perfil.' }, 500)
    }

    return json({
      id: profile.id,
      name: profile.name,
      role: profile.role,
      rank: profile.rank,
      active: profile.active,
      permissions: profile.permissions,
      authEmail: profile.auth_email,
      legacyId: profile.legacy_id,
      pin: profile.pin || pin,
    })
  }

  if (action === 'update') {
    const targetId = String(body.targetId || '')
    if (!targetId) return json({ error: 'Perfil objetivo no especificado.' }, 400)
    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, name, role, rank, active, permissions, auth_email, legacy_id, pin')
      .eq('id', targetId)
      .maybeSingle()
    if (targetError || !target) return json({ error: 'No encontramos el perfil.' }, 404)

    const changes = (body.changes && typeof body.changes === 'object') ? body.changes as Record<string, unknown> : {}
    if (Array.isArray(changes.permissions) && actor.role !== 'manager') {
      return json({ error: 'La sesión remota no corresponde a un Gerente autorizado. Cierra sesión en este dispositivo y vuelve a entrar con el PIN del Gerente.' }, 403)
    }
    const wantsRoleChange = changes.role !== undefined && changes.role !== target.role
    const wantsActiveChange = changes.active !== undefined && changes.active !== target.active
    if (target.role === 'manager') {
      if (target.id !== actorId || wantsRoleChange || wantsActiveChange) return json({ error: 'El gerente principal no puede ser degradado ni desactivado.' }, 403)
    }
    if (wantsRoleChange && actor.role !== 'manager') return json({ error: 'Solo el gerente puede cambiar roles.' }, 403)
    if (changes.role !== undefined && !['admin', 'employee', 'manager'].includes(String(changes.role))) return json({ error: 'Rol inválido.' }, 400)
    if (String(changes.role || target.role) === 'manager' && target.role !== 'manager') return json({ error: 'No se pueden crear más perfiles gerente.' }, 403)
    if (wantsActiveChange && target.role === 'admin' && actor.role !== 'manager') return json({ error: 'Solo el gerente puede desactivar administradores.' }, 403)
    if (target.id === actorId && wantsActiveChange) return json({ error: 'No puedes desactivar tu propia sesión.' }, 403)
    if (target.role === 'manager') return json({ error: 'El gerente principal no admite ese cambio.' }, 403)

    const profileUpdate: Record<string, unknown> = {}
    if (typeof changes.name === 'string' && cleanName(changes.name).length >= 2) profileUpdate.name = cleanName(changes.name)
    if (typeof changes.rank === 'string' && cleanName(changes.rank).length >= 2) profileUpdate.rank = cleanName(changes.rank)
    if (typeof changes.active === 'boolean') profileUpdate.active = changes.active
    if (wantsRoleChange) profileUpdate.role = String(changes.role)
    if (actor.role === 'manager' && Array.isArray(changes.permissions)) {
      const allowed = ['dashboard.view','pos.access','customers.manage','customers.export','sales.view','sales.delete','products.manage','reports.view','cashClosing.access','settings.general','settings.orders','settings.payments','settings.categories','invoice.settings']
      profileUpdate.permissions = Array.from(new Set(changes.permissions.filter(item => allowed.includes(String(item)))))
    }

    if (typeof changes.pin === 'string' && changes.pin) {
      if (!validPin(changes.pin)) return json({ error: 'El PIN debe tener 4 números.' }, 400)
      profileUpdate.pin = changes.pin
      const { error: passwordError } = await admin.auth.admin.updateUserById(targetId, { password: pinPassword(changes.pin) })
      if (passwordError) return json({ error: passwordError.message }, 400)
    }

    const { data: updated, error: updateError } = await admin
      .from('profiles')
      .update(profileUpdate)
      .eq('id', targetId)
      .select('id, name, role, rank, active, permissions, auth_email, legacy_id, pin')
      .maybeSingle()
    if (updateError || !updated) return json({ error: updateError?.message || 'No fue posible actualizar el perfil.' }, 400)

    return json({
      id: updated.id,
      name: updated.name,
      role: updated.role,
      rank: updated.rank,
      active: updated.active,
      permissions: updated.permissions,
      authEmail: updated.auth_email,
      legacyId: updated.legacy_id,
      pin: updated.pin || '',
    })
  }

  if (action === 'delete') {
    if (actor.role !== 'manager') return json({ error: 'Solo el gerente puede eliminar perfiles.' }, 403)
    const targetId = String(body.targetId || '')
    if (!targetId || targetId === actorId) return json({ error: 'Perfil no válido.' }, 400)
    const { data: target } = await admin.from('profiles').select('id, role').eq('id', targetId).maybeSingle()
    if (!target || target.role === 'manager') return json({ error: 'Ese perfil no se puede eliminar.' }, 403)
    const { error } = await admin.auth.admin.deleteUser(targetId)
    if (error) return json({ error: error.message || 'No fue posible eliminar la cuenta.' }, 400)
    return json({ ok: true, id: targetId })
  }

  return json({ error: 'Acción no reconocida.' }, 400)
})
