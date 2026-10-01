import { ArrowRight, Command, ShieldCheck, UserRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { initials, setSessionUser } from '../lib/auth'
import { getUsers } from '../lib/store'
import type { User } from '../lib/types'

const roleLabel = (role: User['role']) => role === 'manager' ? 'Gerente' : role === 'admin' ? 'Administrador' : 'Trabajador'
const STREAMLINX_ACCESS_PIN = '7391'

export function Login() {
  const [users, setUsers] = useState<User[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [streamlinxOpen, setStreamlinxOpen] = useState(false)
  const [streamlinxPin, setStreamlinxPin] = useState('')
  const [streamlinxError, setStreamlinxError] = useState('')
  const [terminalLine, setTerminalLine] = useState(0)
  const navigate = useNavigate()

  useEffect(() => { getUsers().then(all => { const active = all.filter(user => user.active); setUsers(active); if (active[0]) setSelectedId(active[0].id) }) }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey && event.altKey && event.key.toLowerCase() === 'x') {
        event.preventDefault()
        setStreamlinxOpen(true)
        setStreamlinxPin('')
        setStreamlinxError('')
        setTerminalLine(0)
      }
      if (event.key === 'Escape' && streamlinxOpen) setStreamlinxOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [streamlinxOpen])

  useEffect(() => {
    if (!streamlinxOpen) return
    const timer = window.setInterval(() => setTerminalLine(line => Math.min(line + 1, 4)), 280)
    return () => window.clearInterval(timer)
  }, [streamlinxOpen])

  const selected = users.find(user => user.id === selectedId)
  const submit = () => {
    if (!selected) return
    if (pin !== selected.pin) return setError('PIN incorrecto.')
    setSessionUser(selected)
    navigate('/', { replace: true })
  }
  const submitStreamLinx = () => {
    if (streamlinxPin !== STREAMLINX_ACCESS_PIN) return setStreamlinxError('IDENTIDAD NO VERIFICADA // ACCESO DENEGADO')
    navigate('/streamlinx', { replace: true })
  }

  return <div className="login-page"><div className="login-card">
    <div className="login-brand"><div className="brand-mark">S</div><div><strong>smaky</strong><span>POS</span></div></div>
    <div className="login-copy"><p className="eyebrow">ACCESO SEGURO</p><h1>¿Quién está entrando?</h1><p>Selecciona tu perfil e ingresa tu PIN de 4 números.</p></div>
    <div className="login-users">{users.map(user => <button key={user.id} className={`login-user ${selectedId === user.id ? 'selected' : ''}`} onClick={() => { setSelectedId(user.id); setPin(''); setError('') }}><div className="avatar">{initials(user.name)}</div><div><b>{user.name}</b><span>{roleLabel(user.role)} · {user.rank}</span></div>{user.role === 'employee' ? <UserRound size={16}/> : <ShieldCheck size={16}/>}</button>)}</div>
    {selected && <div className="login-pin"><span><ShieldCheck size={13}/> PIN de {selected.name}</span><input autoFocus inputMode="numeric" maxLength={4} type="password" value={pin} onChange={event => { setPin(event.target.value.replace(/\D/g,'').slice(0,4)); setError('') }} onKeyDown={event => event.key === 'Enter' && submit()} placeholder="••••" />{error && <p className="form-error">{error}</p>}<button className="primary login-submit" disabled={pin.length !== 4} onClick={submit}>Iniciar sesión <ArrowRight size={14}/></button></div>}
    <p className="login-hint">Tu PIN es personal. No lo compartas con otros usuarios.</p>
  </div>

  {streamlinxOpen && <div className="slx-gate" role="dialog" aria-modal="true">
    <div className="slx-gate-noise"/>
    <button className="slx-gate-close" onClick={() => setStreamlinxOpen(false)} aria-label="Cerrar"><X size={17}/></button>
    <div className="slx-gate-center">
      <div className="slx-gate-logo"><img src="/Streamlinx.png" alt="StreamLinx" onError={event => { event.currentTarget.style.display = 'none' }} /><span>SL</span></div>
      <div className="slx-gate-brand">STREAMLINX <small>PRIVATE SYSTEM</small></div>
      <div className="slx-terminal">
        <div className="slx-terminal-bar"><span/><span/><span/><b>streamlinx://core/access</b></div>
        <div className="slx-terminal-body">
          {terminalLine >= 1 && <p><i>[ OK ]</i> Initializing private interface...</p>}
          {terminalLine >= 2 && <p><i>[ OK ]</i> Loading StreamLinx core...</p>}
          {terminalLine >= 3 && <p><i>[ OK ]</i> Secure channel established.</p>}
          {terminalLine >= 4 && <p><i>[AUTH]</i> Identity verification required.</p>}
          <div className="slx-auth-line"><span>&gt; VERIFICAR IDENTIDAD:</span><input autoFocus inputMode="numeric" maxLength={4} type="password" value={streamlinxPin} onChange={event => { setStreamlinxPin(event.target.value.replace(/\D/g,'').slice(0,4)); setStreamlinxError('') }} onKeyDown={event => event.key === 'Enter' && submitStreamLinx()} placeholder="____" /></div>
          {streamlinxError && <div className="slx-auth-error">{streamlinxError}</div>}
        </div>
      </div>
      <button className="slx-auth-button" disabled={streamlinxPin.length !== 4} onClick={submitStreamLinx}><Command size={14}/> ENTRAR AL CENTRO <ArrowRight size={14}/></button>
      <span className="slx-gate-hint">ESC para cancelar · canal interno</span>
    </div>
  </div>}
  </div>
}
