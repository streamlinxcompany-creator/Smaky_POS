import { Check, CircleUserRound, Eye, EyeOff, KeyRound, LockKeyhole, Plus, Save, ShieldCheck, SlidersHorizontal, UserRound, UserRoundCog, X, Power, BriefcaseBusiness, Trash2, AlertTriangle, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { getSessionUser } from '../lib/auth'
import { createWorker, deleteUserProfile, getUsers, updateUserSettings } from '../lib/store'
import type { Role, User } from '../lib/types'

type SettingsForm = { name: string; pin: string; rank: string; role: Role; active: boolean }

const roleLabel = (role: Role) => role === 'manager' ? 'Gerente' : role === 'admin' ? 'Administrador' : 'Trabajador'

export function Users() {
  const [users, setUsers] = useState<User[]>([])
  const [creating, setCreating] = useState(false)
  const [configuring, setConfiguring] = useState<User | null>(null)
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [rank, setRank] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState(0)
  const deleteProgressRef = useRef(0)
  const deleteDraggingRef = useRef(false)
  const deleteDragStartXRef = useRef(0)
  const deleteDragStartProgressRef = useRef(0)
  const currentUser = getSessionUser()
  const canManageRoles = currentUser?.role === 'manager'

  const load = () => getUsers().then(setUsers)
  useEffect(() => { void load() }, [])

  const closeCreate = () => { setCreating(false); setName(''); setPin(''); setRank(''); setError(''); setShowPin(false) }
  const closeConfig = () => { setConfiguring(null); setForm(null); setError(''); setShowPin(false); setDeleting(false); setDeleteProgress(0) }
  const openDelete = () => { deleteProgressRef.current = 0; setDeleteProgress(0); setDeleting(true) }
  const cancelDelete = () => { deleteDraggingRef.current = false; setDeleting(false); deleteProgressRef.current = 0; setDeleteProgress(0) }
  const confirmDelete = async () => {
    if (!configuring || !currentUser || deleteProgressRef.current < 92) return
    const removed = await deleteUserProfile(configuring.id, currentUser.id)
    if (!removed) {
      setDeleting(false)
      return setError('No tienes permiso para eliminar este perfil.')
    }
    setDeleting(false)
    deleteProgressRef.current = 0
    setDeleteProgress(0)
    setConfiguring(null)
    setForm(null)
    setError('')
    await load()
  }
  const startDeleteSlide = (event: PointerEvent<HTMLDivElement>) => {
    if (!deleting) return
    deleteDraggingRef.current = true
    deleteDragStartXRef.current = event.clientX
    deleteDragStartProgressRef.current = deleteProgressRef.current
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const updateDeleteSlide = (event: PointerEvent<HTMLDivElement>) => {
    if (!deleteDraggingRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const travel = Math.max(1, bounds.width - 64)
    const delta = ((event.clientX - deleteDragStartXRef.current) / travel) * 100
    const next = Math.max(0, Math.min(100, deleteDragStartProgressRef.current + delta))
    deleteProgressRef.current = next
    setDeleteProgress(next)
  }

  const finishDeleteSlide = () => {
    deleteDraggingRef.current = false
    if (deleteProgressRef.current >= 92) void confirmDelete()
    else {
      deleteProgressRef.current = 0
      setDeleteProgress(0)
    }
  }

  const submit = async () => {
    if (name.trim().length < 2) return setError('Escribe un nombre válido.')
    if (!/^\d{4}$/.test(pin)) return setError('La contraseña debe tener exactamente 4 números.')
    if (rank.trim().length < 2) return setError('Escribe el rango del trabajador.')
    await createWorker(name, pin, rank)
    closeCreate()
    await load()
  }

  const openConfig = (user: User) => {
    setConfiguring(user)
    setForm({ name: user.name, pin: user.pin, rank: user.rank || (user.role === 'employee' ? 'Trabajador' : user.role === 'admin' ? 'Administrador' : 'Gerente General'), role: user.role, active: user.active })
    setError('')
    setShowPin(false)
  }

  const saveConfig = async () => {
    if (!form || !configuring || !currentUser) return
    if (form.name.trim().length < 2) return setError('Escribe un nombre válido.')
    if (!/^\d{4}$/.test(form.pin)) return setError('La contraseña debe tener exactamente 4 números.')
    if (form.rank.trim().length < 2) return setError('El rango es obligatorio.')
    setSaving(true)
    try {
      await updateUserSettings(configuring.id, form, currentUser.id)
      await load()
      closeConfig()
    } finally { setSaving(false) }
  }

  const initials = (fullName: string) => fullName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'S'

  return <div>
    <div className="page-heading compact">
      <div><p className="eyebrow">PERSONAL Y ACCESOS</p><h1>Usuarios</h1><p className="muted">Administra el equipo, sus rangos y los permisos de Smaky.</p></div>
      <button className="primary users-add" onClick={() => setCreating(true)}><Plus size={16}/> Agregar trabajador</button>
    </div>

    <div className="users-toolbar">
      <div><span className="toolbar-dot"></span><b>{users.filter(u => u.active).length}</b> cuentas activas <span className="toolbar-separator">·</span> {users.length} registradas</div>
      <span>{canManageRoles ? 'Gerente: control total de perfiles' : 'Administrador: gestión operativa del equipo'}</span>
    </div>

    <div className="users-list">
      {users.map(user => <div className={`panel user-row ${!user.active ? 'is-disabled' : ''}`} key={user.id}>
        <div className="avatar large">{initials(user.name)}</div>
        <div className="user-info"><h2>{user.name}{user.id === currentUser?.id && <span className="you-tag">Tú</span>}</h2><p>{user.rank || roleLabel(user.role)} · {user.role === 'employee' ? 'Inicio · Punto de venta · Ventas' : 'Acceso administrativo'}</p></div>
        <div className="user-status-stack"><span className={`badge ${user.role === 'employee' ? 'employee-badge' : user.role === 'manager' ? 'manager-badge' : 'admin-badge'}`}>{user.role === 'employee' ? <UserRound size={14}/> : <ShieldCheck size={14}/>} {roleLabel(user.role)}</span><small className={user.active ? 'status-active' : 'status-off'}>{user.active ? 'Activo' : 'Desactivado'}</small></div>
        <button className="config-btn" onClick={() => openConfig(user)}><SlidersHorizontal size={15}/> Configuración</button>
      </div>)}
    </div>

    <div className="panel users-note"><div className="stat-icon"><KeyRound size={18}/></div><div><b>Perfiles a tu medida</b><p>Desde Configuración puedes cambiar nombre, PIN, rango y estado. El Gerente además puede convertir trabajadores en Administradores o degradar Administradores a Trabajadores.</p></div></div>

    {creating && <div className="modal-backdrop"><div className="modal user-create-modal profile-modal">
      <div className="modal-header"><div><p className="eyebrow">NUEVO PERFIL</p><h2>Agregar trabajador</h2><p>Crea una cuenta lista para entrar a Smaky con su PIN y rango.</p></div><button className="icon-btn" onClick={closeCreate}><X size={17}/></button></div>
      <form onSubmit={event => { event.preventDefault(); void submit() }}>
        <div className="profile-form-head"><div className="profile-preview"><div className="avatar giant">{initials(name || 'Nuevo trabajador')}</div><div><b>{name || 'Nuevo trabajador'}</b><span>{rank || 'Rango por definir'}</span></div></div><span className="badge employee-badge"><UserRound size={14}/> Trabajador</span></div>
        <div className="form-row user-form-grid"><label>Nombre completo<input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Ej. Juan Pérez" /></label><label>Contraseña / PIN<input inputMode="numeric" maxLength={4} type={showPin ? 'text' : 'password'} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g,'').slice(0,4))} placeholder="1234" /></label><label>Rango<input value={rank} onChange={event => setRank(event.target.value)} placeholder="Ej. Cajero" /></label></div>
        <button type="button" className="pin-visibility" onClick={() => setShowPin(value => !value)}>{showPin ? <EyeOff size={14}/> : <Eye size={14}/>} {showPin ? 'Ocultar PIN' : 'Mostrar PIN'}</button>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={closeCreate}>Cancelar</button><button type="submit" className="primary"><Plus size={14}/> Crear trabajador</button></div>
      </form>
    </div></div>}

    {configuring && form && <div className="modal-backdrop"><div className="modal user-config-modal">
      <div className="modal-header"><div><p className="eyebrow">CONFIGURACIÓN DE PERFIL</p><h2>{configuring.name}</h2><p>Edita los datos y permisos de esta cuenta desde un solo lugar.</p></div><button className="icon-btn" onClick={closeConfig}><X size={17}/></button></div>
      <div className="config-hero"><div className={`avatar giant ${form.active ? '' : 'avatar-off'}`}>{initials(form.name)}</div><div className="config-hero-copy"><strong>{form.name}</strong><small>{roleLabel(form.role)} {configuring.id === currentUser?.id ? '· Tu sesión actual' : ''}</small></div><div className={`account-state ${form.active ? 'on' : 'off'}`}><span></span>{form.active ? 'Activo' : 'Desactivado'}</div></div>
      <form onSubmit={event => { event.preventDefault(); void saveConfig() }}>
        <div className="config-section"><div className="config-section-title"><BriefcaseBusiness size={15}/><div><b>Información</b><span>Identidad del trabajador.</span></div></div><div className="form-row config-grid"><label>Nombre<input value={form.name} onChange={event => setForm({...form, name:event.target.value})} /></label></div></div>
        <div className="config-section"><div className="config-section-title"><LockKeyhole size={15}/><div><b>Seguridad</b><span>El PIN de 4 números se usa para iniciar sesión.</span></div></div><label>Contraseña / PIN<div className="pin-field"><input inputMode="numeric" maxLength={4} type={showPin ? 'text' : 'password'} value={form.pin} onChange={event => setForm({...form, pin:event.target.value.replace(/\D/g,'').slice(0,4)})}/><button type="button" onClick={() => setShowPin(v => !v)}>{showPin ? <EyeOff size={15}/> : <Eye size={15}/>}</button></div></label></div>
        <div className="config-section"><div className="config-section-title"><UserRoundCog size={15}/><div><b>Permisos</b><span>{canManageRoles ? 'El Gerente puede ajustar el nivel de acceso.' : 'Puedes administrar trabajadores, pero no cambiar niveles.'}</span></div></div><div className="role-choice-grid">
          <button type="button" className={`role-choice ${form.role === 'employee' ? 'selected' : ''}`} onClick={() => canManageRoles && setForm({...form, role:'employee'})} disabled={!canManageRoles || configuring.id === currentUser?.id}><UserRound size={17}/><span><b>Trabajador</b><small>Inicio, POS y ventas</small></span><span className="choice-dot"></span></button>
          <button type="button" className={`role-choice ${form.role === 'admin' ? 'selected' : ''}`} onClick={() => canManageRoles && setForm({...form, role:'admin'})} disabled={!canManageRoles || configuring.id === currentUser?.id}><ShieldCheck size={17}/><span><b>Administrador</b><small>Acceso administrativo</small></span><span className="choice-dot"></span></button>
          {configuring.role === 'manager' && <div className="manager-lock"><LockKeyhole size={15}/><div><b>Gerente principal</b><span>Este perfil es el máximo nivel de acceso y no puede degradarse ni desactivarse.</span></div></div>}
        </div></div>
        <div className="config-section"><div className="config-section-title"><Power size={15}/><div><b>Estado de la cuenta</b><span>Controla si puede iniciar sesión.</span></div></div><button type="button" className={`toggle-row ${form.active ? 'enabled' : ''}`} disabled={configuring.id === currentUser?.id || configuring.role === 'manager'} onClick={() => setForm({...form, active:!form.active})}><div><b>{form.active ? 'Cuenta activa' : 'Cuenta desactivada'}</b><span>{form.active ? 'Puede iniciar sesión normalmente.' : 'No podrá entrar hasta volver a activarla.'}</span></div><span className="switch"><i></i></span></button></div>
        {configuring.role !== 'manager' && configuring.id !== currentUser?.id && <div className="config-danger"><div className="config-section-title danger-title"><Trash2 size={15}/><div><b>Zona de peligro</b><span>Eliminar este perfil borrará su cuenta de Smaky.</span></div></div><button type="button" className="delete-profile-btn" onClick={openDelete}><Trash2 size={15}/> Eliminar {configuring.role === 'employee' ? 'trabajador' : 'administrador'}</button></div>}
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={closeConfig}>Cancelar</button><button type="submit" className="primary" disabled={saving}><Save size={14}/>{saving ? 'Guardando…' : 'Guardar cambios'}</button></div>
      </form>
    </div></div>}

    {deleting && configuring && <div className="modal-backdrop danger-backdrop"><div className="delete-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-profile-title">
      <button className="checkout-modal-close" onClick={cancelDelete} aria-label="Cancelar"><X size={18}/></button>
      <div className="delete-confirm-icon"><AlertTriangle size={20}/></div>
      <p className="eyebrow danger-eyebrow">ELIMINAR PERFIL</p>
      <h2 id="delete-profile-title">¿Seguro que quieres eliminar a {configuring.name}?</h2>
      <p className="delete-confirm-copy">Esta acción eliminará su perfil y ya no podrá iniciar sesión en Smaky. No se puede deshacer desde esta pantalla.</p>
      <div className={`delete-slider ${deleteProgress >= 92 ? 'ready' : ''}`}>
        <div className="delete-slider-fill" style={{ width: `${deleteProgress}%` }}/><div className="delete-slider-text">{deleteProgress >= 92 ? 'Suelta para eliminar' : 'Desliza la flecha hacia la derecha'}</div><div className="delete-slider-thumb" style={{ left: `calc(${8 + (Math.min(100, Math.max(0, deleteProgress)) * 0.84)}% - 24px)` }} onPointerDown={startDeleteSlide} onPointerMove={updateDeleteSlide} onPointerUp={finishDeleteSlide} onPointerCancel={finishDeleteSlide}><ChevronRight size={19}/></div>
      </div>
      <button type="button" className="cancel-delete-btn" onClick={cancelDelete}>Cancelar</button>
    </div></div>}
  </div>
}
