import { ArrowRight, Command, Fingerprint, LockKeyhole, ShieldCheck, UserRound, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { initials, setStreamlinxSession, signInWithPin } from '../lib/auth'
import { getUsers } from '../lib/store'
import type { User } from '../lib/types'

const roleLabel = (role: User['role']) => role === 'manager' ? 'Gerente' : role === 'admin' ? 'Administrador' : 'Trabajador'
const STREAMLINX_ACCESS_PIN = '7391'

export function Login() {
  const [users, setUsers] = useState<User[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [streamlinxOpen, setStreamlinxOpen] = useState(false)
  const [streamlinxPin, setStreamlinxPin] = useState('')
  const [streamlinxError, setStreamlinxError] = useState('')
  const [terminalLine, setTerminalLine] = useState(0)
  const [gateStage, setGateStage] = useState(0)
  const [sessionCode, setSessionCode] = useState('SLX-0000-0000')
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    const loadUsers = async () => {
      try {
        const all = await getUsers()
        if (cancelled) return
        const active = all.filter(user => user.active)
        setUsers(active)
        setSelectedId(current => active.some(user => user.id === current) ? current : (active[0]?.id || ''))
      } catch (loadError) {
        console.error('Smaky: no fue posible cargar los perfiles de acceso:', loadError)
      }
    }

    void loadUsers()
    const onDataReady = () => { void loadUsers() }
    window.addEventListener('smaky-data-ready', onDataReady)
    return () => {
      cancelled = true
      window.removeEventListener('smaky-data-ready', onDataReady)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey && event.altKey && event.key.toLowerCase() === 'x') {
        event.preventDefault()
        setStreamlinxOpen(true)
        setStreamlinxPin('')
        setStreamlinxError('')
        setTerminalLine(0)
        setGateStage(0)
        const stamp = Date.now().toString(16).toUpperCase().slice(-8)
        setSessionCode(`SLX-${stamp.slice(0,4)}-${stamp.slice(4)}`)
      }
      if (event.key === 'Escape' && streamlinxOpen) setStreamlinxOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [streamlinxOpen])

  useEffect(() => {
    if (!streamlinxOpen) return
    const timer = window.setInterval(() => {
      setGateStage(stage => Math.min(stage + 1, 6))
      setTerminalLine(line => Math.min(line + 1, 5))
    }, 360)
    return () => window.clearInterval(timer)
  }, [streamlinxOpen])

  const selected = users.find(user => user.id === selectedId)
  const submit = async () => {
    if (!selected || submitting) return
    setError('')
    setSubmitting(true)
    try {
      const result = await signInWithPin(selected, pin)
      if (!result.user) {
        setError(result.error || 'PIN incorrecto.')
        return
      }
      navigate('/', { replace: true })
    } catch (requestError) {
      console.error('Smaky login exception:', requestError)
      setError(requestError instanceof Error ? requestError.message : 'No fue posible iniciar la sesión.')
    } finally {
      setSubmitting(false)
    }
  }
  const submitStreamLinx = () => {
    if (streamlinxPin !== STREAMLINX_ACCESS_PIN) return setStreamlinxError('IDENTIDAD NO VERIFICADA // ACCESO DENEGADO')
    setStreamlinxSession()
    navigate('/streamlinx', { replace: true })
  }

  return <div className="login-page"><div className="login-card">
    <div className="login-brand"><div className="brand-mark">S</div><div><strong>smaky</strong><span>POS</span></div></div>
    <div className="login-copy"><p className="eyebrow">ACCESO SEGURO</p><h1>¿Quién está entrando?</h1><p>Selecciona tu perfil e ingresa tu PIN de 4 números.</p></div>
    <div className="login-users">{users.map(user => <button key={user.id} className={`login-user ${selectedId === user.id ? 'selected' : ''}`} onClick={() => { setSelectedId(user.id); setPin(''); setError('') }}><div className="avatar">{initials(user.name)}</div><div><b>{user.name}</b><span>{roleLabel(user.role)} · {user.rank}</span></div>{user.role === 'employee' ? <UserRound size={16}/> : <ShieldCheck size={16}/>}</button>)}</div>
    {selected && <div className="login-pin"><span><ShieldCheck size={13}/> PIN de {selected.name}</span><input autoFocus inputMode="numeric" maxLength={4} type="password" value={pin} onChange={event => { setPin(event.target.value.replace(/\D/g,'').slice(0,4)); setError('') }} onKeyDown={event => event.key === 'Enter' && submit()} placeholder="••••" />{error && <p className="form-error">{error}</p>}<button className="primary login-submit" disabled={pin.length !== 4 || submitting} onClick={submit}>{submitting ? 'Conectando…' : 'Iniciar sesión'} {!submitting && <ArrowRight size={14}/>}</button></div>}
    <p className="login-hint">Tu PIN es personal. No lo compartas con otros usuarios.</p>
  </div>

  {streamlinxOpen && <div className="slx-gate-v2" role="dialog" aria-modal="true">
    <div className="slx-v2-grid"/>
    <div className="slx-v2-scanlines"/>
    <div className="slx-v2-noise"/>
    <div className="slx-v2-corner slx-v2-corner-tl"/>
    <div className="slx-v2-corner slx-v2-corner-tr"/>
    <div className="slx-v2-corner slx-v2-corner-bl"/>
    <div className="slx-v2-corner slx-v2-corner-br"/>
    <button className="slx-v2-close" onClick={() => setStreamlinxOpen(false)} aria-label="Cerrar"><X size={15}/></button>

    <div className={`slx-v2-stage stage-${Math.min(gateStage, 6)}`}>
      <div className="slx-v2-topline"><span>STREAMLINX // PRIVATE INFRASTRUCTURE</span><span>NODE 01 · SECURE BOOT</span></div>

      <div className="slx-v2-identity">
        <div className="slx-v2-orbit orbit-a"/>
        <div className="slx-v2-orbit orbit-b"/>
        <div className="slx-v2-reticle"><span/><i/><b/></div>
        <div className="slx-v2-logo-frame">
          <div className="slx-v2-logo-scan"/>
          <img src="/Streamlinx.png" alt="StreamLinx" onError={event => { event.currentTarget.style.display = 'none' }} />
          <span>SLX</span>
        </div>
        <div className="slx-v2-brand">STREAMLINX</div>
        <div className="slx-v2-classified">RESTRICTED SYSTEM · INTERNAL USE ONLY</div>
      </div>

      <div className="slx-v2-access-card">
        <div className="slx-v2-card-head">
          <div><span className="slx-v2-dot"/> SECURE ACCESS TERMINAL</div>
          <span>CLASS: 04</span>
        </div>
        <div className="slx-v2-terminal">
          <div className="slx-v2-terminal-top">
            <span>CORE://AUTHENTICATION</span>
            <span>{sessionCode}</span>
          </div>
          <div className="slx-v2-terminal-body">
            <div className="slx-v2-boot-lines">
              {gateStage >= 1 && <p><b>01</b><i>OK</i> INITIALIZING SECURE KERNEL <em>100%</em></p>}
              {gateStage >= 2 && <p><b>02</b><i>OK</i> VERIFYING SYSTEM INTEGRITY <em>100%</em></p>}
              {gateStage >= 3 && <p><b>03</b><i>OK</i> ESTABLISHING ENCRYPTED CHANNEL <em>AES-256</em></p>}
              {gateStage >= 4 && <p><b>04</b><i>OK</i> LOADING PRIVATE STREAMLINX CORE <em>READY</em></p>}
              {gateStage >= 5 && <p className="critical"><b>05</b><i>AUTH</i> PRIVILEGED IDENTITY REQUIRED <em>LEVEL 04</em></p>}
            </div>

            <div className={`slx-v2-auth ${gateStage >= 5 ? 'active' : ''}`}>
              <div className="slx-v2-auth-title"><Fingerprint size={15}/> IDENTITY VERIFICATION</div>
              <div className="slx-v2-auth-row">
                <span>&gt; ENTER CLEARANCE PIN</span>
                <input autoFocus={gateStage >= 5} inputMode="numeric" maxLength={4} type="password" value={streamlinxPin} onChange={event => { setStreamlinxPin(event.target.value.replace(/\D/g,'').slice(0,4)); setStreamlinxError('') }} onKeyDown={event => event.key === 'Enter' && submitStreamLinx()} placeholder="••••" />
              </div>
              {streamlinxError && <div className="slx-v2-auth-error"><LockKeyhole size={13}/>{streamlinxError}</div>}
            </div>
          </div>
        </div>

        <div className="slx-v2-meter">
          <div><span>SECURITY HANDSHAKE</span><b>{Math.min(gateStage * 16 + (gateStage >= 5 ? 20 : 0), 100)}%</b></div>
          <div className="slx-v2-meter-track"><span style={{width: `${Math.min(gateStage * 16 + (gateStage >= 5 ? 20 : 0), 100)}%`}}/></div>
        </div>

        <button className="slx-v2-enter" disabled={gateStage < 5 || streamlinxPin.length !== 4} onClick={submitStreamLinx}>
          <span><Command size={14}/> ACCESS STREAMLINX CORE</span><ArrowRight size={15}/>
        </button>
      </div>

      <div className="slx-v2-footer">
        <span><b>SESSION</b> {sessionCode}</span>
        <span><b>STATUS</b> {gateStage >= 5 ? 'AWAITING AUTHORIZATION' : 'SECURE BOOT IN PROGRESS'}</span>
        <span><b>ESC</b> CANCEL</span>
      </div>
    </div>
  </div>}
  </div>
}
