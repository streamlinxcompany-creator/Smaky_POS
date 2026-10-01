import { ArrowRight, ShieldCheck, UserRound } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { initials, setSessionUser } from '../lib/auth'
import { getUsers } from '../lib/store'
import type { User } from '../lib/types'

const roleLabel = (role: User['role']) => role === 'manager' ? 'Gerente' : role === 'admin' ? 'Administrador' : 'Trabajador'

const StreamLinxGate = lazy(() => import('../streamlinx/StreamLinxGate').then(module => ({ default: module.StreamLinxGate })))

export function Login() {
  const [users, setUsers] = useState<User[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [streamLinxOpen, setStreamLinxOpen] = useState(false)
  const navigate = useNavigate()
  useEffect(() => { getUsers().then(all => { const active = all.filter(user => user.active); setUsers(active); if (active[0]) setSelectedId(active[0].id) }) }, [])
  useEffect(() => {
    const openSecret = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'm') {
        event.preventDefault()
        setStreamLinxOpen(true)
      }
    }
    window.addEventListener('keydown', openSecret)
    return () => window.removeEventListener('keydown', openSecret)
  }, [])
  const selected = users.find(user => user.id === selectedId)
  const submit = () => {
    if (!selected) return
    if (pin !== selected.pin) return setError('PIN incorrecto.')
    setSessionUser(selected)
    navigate('/', { replace: true })
  }
  return <div className="login-page"><div className="login-card">
    <div className="login-brand"><div className="brand-mark">S</div><div><strong>smaky</strong><span>POS</span></div></div>
    <div className="login-copy"><p className="eyebrow">ACCESO SEGURO</p><h1>¿Quién está entrando?</h1><p>Selecciona tu perfil e ingresa tu PIN de 4 números.</p></div>
    <div className="login-users">{users.map(user => <button key={user.id} className={`login-user ${selectedId === user.id ? 'selected' : ''}`} onClick={() => { setSelectedId(user.id); setPin(''); setError('') }}><div className="avatar">{initials(user.name)}</div><div><b>{user.name}</b><span>{roleLabel(user.role)} · {user.rank}</span></div>{user.role === 'employee' ? <UserRound size={16}/> : <ShieldCheck size={16}/>}</button>)}</div>
    {selected && <div className="login-pin"><span><ShieldCheck size={13}/> PIN de {selected.name}</span><input autoFocus inputMode="numeric" maxLength={4} type="password" value={pin} onChange={event => { setPin(event.target.value.replace(/\D/g,'').slice(0,4)); setError('') }} onKeyDown={event => event.key === 'Enter' && submit()} placeholder="••••" />{error && <p className="form-error">{error}</p>}<button className="primary login-submit" disabled={pin.length !== 4} onClick={submit}>Iniciar sesión <ArrowRight size={14}/></button></div>}
    <p className="login-hint">Tu PIN es personal. No lo compartas con otros usuarios.</p>
  </div>{streamLinxOpen && <Suspense fallback={null}><StreamLinxGate onClose={() => setStreamLinxOpen(false)} /></Suspense>}</div>
}
