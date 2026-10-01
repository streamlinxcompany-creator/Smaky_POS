import { useEffect, useMemo, useState } from 'react'
import { Activity, ArrowUpRight, Bot, Boxes, Command, Cpu, LogOut, Radar, ShieldCheck, Sparkles, Terminal, Users, Zap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const modules = [
  { name: 'Operaciones', detail: 'Centro de control', icon: Radar, status: 'ACTIVO' },
  { name: 'Proyectos', detail: 'En preparación', icon: Boxes, status: 'PRÓXIMAMENTE' },
  { name: 'Clientes', detail: 'En preparación', icon: Users, status: 'PRÓXIMAMENTE' },
  { name: 'MAICOL', detail: 'IA de StreamLinx', icon: Bot, status: 'CONECTOR PENDIENTE', special: true },
]

export function StreamLinx() {
  const navigate = useNavigate()
  const [clock, setClock] = useState(new Date())
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000)
    const boot = window.setTimeout(() => setBooted(true), 850)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(boot)
    }
  }, [])

  const date = useMemo(() => new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: '2-digit', month: 'long' }).format(clock), [clock])
  const time = useMemo(() => new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(clock), [clock])

  if (!booted) {
    return <div className="slx-boot"><div className="slx-boot-orbit"/><img src="/Streamlinx.png" alt="StreamLinx" onError={event => { event.currentTarget.style.display = 'none' }} /><div className="slx-boot-word">STREAMLINX</div><div className="slx-boot-status"><span/>INICIANDO SISTEMA</div></div>
  }

  return <div className="slx-shell">
    <aside className="slx-sidebar">
      <div className="slx-brand"><div className="slx-logo-wrap"><img src="/Streamlinx.png" alt="StreamLinx" onError={event => { event.currentTarget.style.display = 'none' }} /><span>S</span></div><div><b>StreamLinx</b><small>PRIVATE SYSTEM</small></div></div>
      <div className="slx-access"><span className="slx-pulse"/> ACCESO INTERNO <b>LEVEL 04</b></div>
      <nav>
        <a className="active"><Command size={15}/> Centro</a>
        <a><Activity size={15}/> Actividad</a>
        <a><Boxes size={15}/> Proyectos</a>
        <a><Users size={15}/> Clientes</a>
        <a><Bot size={15}/> MAICOL</a>
      </nav>
      <div className="slx-sidebar-bottom"><div className="slx-terminal-mini"><Terminal size={14}/><div><b>SYSTEM</b><span>Todos los servicios preparados</span></div><i/></div><button onClick={() => navigate('/login')}><LogOut size={14}/> Salir del centro</button></div>
    </aside>

    <main className="slx-main">
      <header className="slx-topbar"><div><span className="slx-kicker">CENTRO STREAMLINX</span><span className="slx-separator">/</span><span className="slx-muted">NÚCLEO PRIVADO</span></div><div className="slx-top-right"><span>{date}</span><strong>{time}</strong></div></header>
      <section className="slx-content">
        <div className="slx-hero"><div><div className="slx-kicker">BIENVENIDO AL NÚCLEO</div><h1>Haz que te vean.</h1><p>Un solo lugar para controlar, crear y hacer crecer el ecosistema StreamLinx.</p></div><div className="slx-hero-mark"><Sparkles size={18}/><span>Arte en Cada Detalle</span></div></div>

        <div className="slx-status-row"><div className="slx-status-main"><div className="slx-live"><span/> SISTEMA OPERATIVO</div><b>StreamLinx Core</b><small>Conexión local segura · Sesión interna</small></div><div className="slx-stat"><span>ACTIVIDAD</span><b>READY</b></div><div className="slx-stat"><span>MAICOL</span><b>STANDBY</b></div><div className="slx-stat"><span>NÚCLEO</span><b>ONLINE</b></div></div>

        <div className="slx-section-title"><div><span className="slx-kicker">ECOSISTEMA</span><h2>Módulos del centro</h2></div><span className="slx-count">04 MÓDULOS</span></div>
        <div className="slx-grid">{modules.map(({ name, detail, icon: Icon, status, special }) => <div className={`slx-module ${special ? 'special' : ''}`} key={name}><div className="slx-module-icon"><Icon size={18}/></div><div className="slx-module-copy"><div><h3>{name}</h3><span>{detail}</span></div><em>{status}</em></div><ArrowUpRight size={15} className="slx-arrow"/></div>)}</div>

        <div className="slx-bottom-grid"><div className="slx-console"><div className="slx-console-head"><div><Terminal size={15}/><b>SYSTEM CONSOLE</b></div><span>LOCAL / ENCRYPTED</span></div><div className="slx-console-body"><p><i>&gt;</i> StreamLinx core initialized.</p><p><i>&gt;</i> Identity layer: <b>VERIFIED</b></p><p><i>&gt;</i> External services: <span className="amber">WAITING FOR CONNECTION</span></p><p><i>&gt;</i> MAICOL interface: <span className="purple">READY FOR API</span><strong>_</strong></p></div></div><div className="slx-manifest"><div className="slx-manifest-icon"><ShieldCheck size={18}/></div><div><span className="slx-kicker">PROTOCOLO INTERNO</span><h3>No hacemos diseños.</h3><p>Hacemos que te vean.</p></div><Zap size={17}/></div></div>
      </section>
    </main>
  </div>
}
