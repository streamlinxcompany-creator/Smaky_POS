import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ChevronRight, LockKeyhole, ShieldCheck, Terminal, X } from 'lucide-react'
import { StreamLinxCore } from './StreamLinxCore'

type GatePhase = 'boot' | 'identity' | 'core'

type LogLine = { text: string; tone?: 'muted' | 'ok' | 'hot' }

const DEFAULT_KEY = 'SLX-CORE-01'
const getCoreKey = () => String(import.meta.env.VITE_STREAMLINX_KEY || DEFAULT_KEY).trim()

const bootLines: LogLine[] = [
  { text: 'SYSTEM // READY' },
  { text: 'waking isolated module................ OK', tone: 'ok' },
  { text: 'establishing secure channel............ OK', tone: 'ok' },
  { text: 'indexing client environment............ OK', tone: 'ok' },
  { text: 'loading intelligence layer............. OK', tone: 'ok' },
  { text: 'MAICOL interface....................... ACTIVE', tone: 'hot' },
  { text: 'private node handshake................. VERIFIED', tone: 'hot' },
]

const glyphs = '01ABCDEF<>/\\[]{}#$%*+=|:.STREAMLINX'.split('')

function MatrixNoise() {
  const columns = useMemo(() => Array.from({ length: 28 }, (_, index) => ({
    left: `${(index / 28) * 100 + (index % 3) * 0.7}%`,
    '--slx-delay': `${-(index * 0.37)}s`,
    '--slx-duration': `${5.5 + (index % 5) * 0.7}s`,
  })), [])

  return <div className="slx-matrix" aria-hidden="true">
    {columns.map((column, index) => <span key={index} style={column as CSSProperties}>{Array.from({ length: 9 + (index % 5) }, (_, i) => glyphs[(index * 7 + i * 5) % glyphs.length]).join('\n')}</span>)}
  </div>
}

function BootScreen({ onReady }: { onReady: () => void }) {
  const [visible, setVisible] = useState(0)
  const [bar, setBar] = useState(0)

  useEffect(() => {
    const lineTimer = window.setInterval(() => setVisible(value => Math.min(bootLines.length, value + 1)), 260)
    const barTimer = window.setInterval(() => setBar(value => Math.min(100, value + 4)), 110)
    const endTimer = window.setTimeout(onReady, 2850)
    return () => {
      window.clearInterval(lineTimer)
      window.clearInterval(barTimer)
      window.clearTimeout(endTimer)
    }
  }, [onReady])

  return <div className="slx-gate-screen slx-boot-screen">
    <MatrixNoise />
    <div className="slx-vignette" />
    <div className="slx-boot-center">
      <div className="slx-logo-shell slx-logo-pulse">
        <div className="slx-logo-ring slx-logo-ring-a" />
        <div className="slx-logo-ring slx-logo-ring-b" />
        <div className="slx-logo-core">
          <img src="/Streamlinx.png" alt="StreamLinx" onError={(event) => { event.currentTarget.style.display = 'none' }} />
          <span className="slx-logo-fallback">SLX</span>
        </div>
      </div>
      <div className="slx-brand-caption">STREAMLINX</div>
      <div className="slx-brand-sub">PRIVATE CORE / NODE 01</div>
    </div>

    <div className="slx-terminal slx-terminal-boot">
      {bootLines.slice(0, visible).map((line, index) => <div key={index} className={`slx-terminal-line ${line.tone || ''}`}><span className="slx-prompt">&gt;</span>{line.text}</div>)}
      <div className="slx-progress-row"><span>CORE INITIALIZATION</span><div><i style={{ width: `${bar}%` }} /></div><b>{bar}%</b></div>
    </div>
  </div>
}

function IdentityScreen({ onUnlock, onClose }: { onUnlock: () => void; onClose: () => void }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  const [holding, setHolding] = useState(false)
  const [progress, setProgress] = useState(0)
  const [shake, setShake] = useState(false)
  const targetKey = getCoreKey()

  useEffect(() => {
    if (!holding) return
    const timer = window.setInterval(() => setProgress(value => Math.min(100, value + 5)), 70)
    return () => window.clearInterval(timer)
  }, [holding])

  useEffect(() => {
    if (progress < 100) return
    setHolding(false)
    if (key.trim().toUpperCase() === targetKey.toUpperCase()) {
      onUnlock()
      return
    }
    setProgress(0)
    setError('Firma de identidad rechazada.')
    setShake(true)
    window.setTimeout(() => setShake(false), 420)
  }, [progress, key, targetKey, onUnlock])

  const stopHold = () => {
    if (progress < 100) setProgress(0)
    setHolding(false)
  }

  return <div className="slx-gate-screen slx-identity-screen">
    <MatrixNoise />
    <div className="slx-vignette" />
    <button className="slx-close" onClick={onClose} aria-label="Cerrar"><X size={17} /></button>

    <div className={`slx-identity-card ${shake ? 'slx-shake' : ''}`}>
      <div className="slx-mini-status"><span className="slx-live-dot" /> PRIVATE ACCESS CHANNEL</div>
      <div className="slx-identity-symbol">
        <div className="slx-symbol-orbit orbit-one" />
        <div className="slx-symbol-orbit orbit-two" />
        <div className="slx-symbol-center"><LockKeyhole size={28} /></div>
      </div>
      <span className="slx-kicker">STREAMLINX // IDENTITY</span>
      <h1>Confirmar identidad</h1>
      <p>Este nodo no pertenece al flujo operativo de Smaky.</p>

      <div className="slx-key-box">
        <div><Terminal size={14} /><span>CORE SIGNATURE</span></div>
        <input
          value={key}
          onChange={event => { setKey(event.target.value.toUpperCase()); setError('') }}
          onKeyDown={event => { if (event.key === 'Enter' && key.trim()) { setProgress(100) } }}
          placeholder="INTRODUCE LA FIRMA"
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {error ? <div className="slx-error"><ShieldCheck size={14} />{error}</div> : <div className="slx-identity-note"><ShieldCheck size={13} />La autorización abre una sesión privada de StreamLinx.</div>}

      <button
        className="slx-authorize"
        disabled={!key.trim()}
        onPointerDown={() => { if (key.trim()) setHolding(true) }}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        onPointerCancel={stopHold}
      >
        <span className="slx-authorize-fill" style={{ width: `${progress}%` }} />
        <span className="slx-authorize-content">
          {progress > 0 && progress < 100 ? <>{Math.round(progress)}% · AUTORIZANDO</> : <>MANTÉN PARA AUTORIZAR <ChevronRight size={16} /></>}
        </span>
      </button>

      <div className="slx-identity-meta"><span>DEVICE CHECK <b>OK</b></span><span>CHANNEL <b>ENCRYPTED</b></span></div>
    </div>
  </div>
}

export function StreamLinxGate({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<GatePhase>('boot')
  const [transitioning, setTransitioning] = useState(false)

  const startIdentity = () => {
    setTransitioning(true)
    window.setTimeout(() => {
      setPhase('identity')
      setTransitioning(false)
    }, 380)
  }

  const enterCore = () => setPhase('core')

  if (phase === 'core') return <StreamLinxCore onExit={onClose} />

  return <div className={`slx-root ${transitioning ? 'slx-transitioning' : ''}`}>
    {phase === 'boot' ? <BootScreen onReady={startIdentity} /> : <IdentityScreen onUnlock={enterCore} onClose={onClose} />}
  </div>
}
