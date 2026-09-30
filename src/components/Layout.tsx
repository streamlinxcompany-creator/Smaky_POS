import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, BarChart3, CircleUserRound, ClipboardList, LayoutDashboard, LogOut, Menu, Package, ShoppingCart, ShieldCheck, Wifi, WifiOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { clearSession, getSessionUser, initials } from '../lib/auth'

const allNav = [
  { to: '/', label: 'Inicio', icon: LayoutDashboard, roles: ['manager', 'admin', 'employee'] },
  { to: '/pos', label: 'Punto de venta', icon: ShoppingCart, roles: ['manager', 'admin', 'employee'] },
  { to: '/ventas', label: 'Ventas', icon: ClipboardList, roles: ['manager', 'admin', 'employee'] },
  { to: '/productos', label: 'Productos', icon: Package, roles: ['manager', 'admin'] },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, roles: ['manager', 'admin'] },
  { to: '/usuarios', label: 'Usuarios', icon: CircleUserRound, roles: ['manager', 'admin'] }
]

const roleLabel = (role: string) => role === 'manager' ? 'Gerente' : role === 'admin' ? 'Administrador' : 'Trabajador'

export function Layout() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const [user, setUser] = useState(getSessionUser())
  const [online, setOnline] = useState(navigator.onLine)
  const [confirmLogout, setConfirmLogout] = useState(false)
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false), sync = () => setUser(getSessionUser())
    window.addEventListener('online', on); window.addEventListener('offline', off); window.addEventListener('smaky-auth-change', sync)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('smaky-auth-change', sync) }
  }, [])
  if (!user) return <Navigate to="/login" replace />
  const nav = allNav.filter(item => item.roles.includes(user.role))
  const isAdminArea = user.role !== 'employee'
  const logout = () => setConfirmLogout(true)
  const confirmLogoutNow = () => {
    setConfirmLogout(false)
    clearSession()
    navigate('/login', { replace: true })
  }
  return <div className="app-shell">
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark">S</div><div><strong>smaky</strong><span>POS</span></div><button className="icon-btn mobile-only" onClick={() => setOpen(false)}><X size={18}/></button></div>
      <div className="business"><span>{isAdminArea ? 'Apartado administrativo de Smaky' : `Hola, ${user.name}`}</span><small>{isAdminArea ? `${roleLabel(user.role)} · Control general` : 'Operación de caja'}</small></div>
      <nav>{nav.map(({to,label,icon:Icon}) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)} className={({isActive}: {isActive: boolean}) => isActive ? 'nav-item active' : 'nav-item'}><Icon size={18}/><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="connection"><span className={`dot ${online ? 'online' : ''}`}></span>{online ? <><Wifi size={15}/> Conectado</> : <><WifiOff size={15}/> Sin conexión</>}</div><button className="profile-mini" onClick={logout}><div className="avatar">{initials(user.name)}</div><div><b>{user.name}</b><small>{roleLabel(user.role)}</small></div><LogOut size={15}/></button></div>
    </aside>
    <main className="main"><header className="topbar"><button className="icon-btn mobile-only" onClick={() => setOpen(true)}><Menu/></button><div className="topbar-title">{isAdminArea ? 'Apartado administrativo de Smaky' : user.name} <span>•</span> <small>{isAdminArea ? `${roleLabel(user.role)} · Control general` : 'Operación'}</small></div><div className="topbar-actions"><div className="live-status"><span className={`dot ${online ? 'online' : ''}`}></span>{online ? 'En línea' : 'Modo offline'}</div></div></header><section className={`content ${location.pathname === '/pos' ? 'pos-content' : ''}`}><Outlet/></section></main>
    {confirmLogout && <div className="modal-backdrop logout-backdrop"><div className="logout-modal" role="dialog" aria-modal="true" aria-labelledby="logout-title">
      <button className="logout-close" onClick={() => setConfirmLogout(false)} aria-label="Cancelar"><X size={17}/></button>
      <div className="logout-icon"><LogOut size={21}/></div>
      <span className="logout-kicker">SESIÓN</span>
      <h2 id="logout-title">¿Cerrar sesión?</h2>
      <p>Vas a salir de Smaky en este dispositivo. Puedes volver a entrar con tu PIN.</p>
      <div className="logout-user"><div className="avatar">{initials(user.name)}</div><div><b>{user.name}</b><small>{roleLabel(user.role)}</small></div><ShieldCheck size={16}/></div>
      <div className="logout-actions"><button className="secondary" onClick={() => setConfirmLogout(false)}>Seguir aquí</button><button className="logout-confirm-btn" onClick={confirmLogoutNow}><LogOut size={15}/> Cerrar sesión</button></div>
    </div></div>}
  </div>
}
