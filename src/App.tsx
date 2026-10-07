import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { POS } from './pages/POS'
import { Sales } from './pages/Sales'
import { Reports } from './pages/Reports'
import { CashClosing } from './pages/CashClosing'
import { Login } from './pages/Login'
import { clearSession, getSessionUser, hasPermission } from './lib/auth'
import type { PermissionKey } from './lib/types'
import { StreamLinx } from './pages/StreamLinx'
import { Settings } from './pages/Settings'
import { Customers } from './pages/Customers'

function PermissionArea({ permission, children, fallback = '/' }: { permission: PermissionKey; children: ReactNode; fallback?: string }) {
  const user = getSessionUser()
  return user && hasPermission(user, permission) ? children : <Navigate to={fallback} replace />
}

function ManagementArea({ children }: { children: ReactNode }) {
  const user = getSessionUser()
  return user && (['manager', 'admin'].includes(user.role) || ['settings.general','settings.orders','settings.payments','settings.categories','products.manage','invoice.settings'].some(permission => hasPermission(user, permission as PermissionKey))) ? children : <Navigate to="/pos" replace />
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Error inesperado de la aplicación.' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Smaky: error de renderizado:', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)', color: 'var(--cream)', fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ width: 'min(620px, 100%)', padding: 28, border: '1px solid var(--line)', borderRadius: 18, background: 'var(--panel)' }}>
        <p className="eyebrow">SMaky · RECUPERACIÓN</p>
        <h1 style={{ marginTop: 0 }}>La aplicación encontró un error</h1>
        <p style={{ color: 'var(--muted)', lineHeight: 1.6 }}>La pantalla se detuvo para evitar mostrar una página negra sin explicación.</p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--cream)', background: 'var(--panel2)', padding: 14, borderRadius: 10, overflow: 'auto' }}>{this.state.message}</pre>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="primary" onClick={() => window.location.reload()}>Recargar Smaky</button>
          <button className="secondary" onClick={() => { clearSession(); window.location.assign('/login') }}>Volver al login</button>
        </div>
      </div>
    </div>
  }
}

export default function App() {
  return <AppErrorBoundary><BrowserRouter><Routes>
    <Route path="/login" element={<Login/>}/>
    <Route path="/streamlinx" element={<StreamLinx/>}/>
    <Route element={<Layout/>}>
      <Route path="/" element={<PermissionArea permission="dashboard.view" fallback="/pos"><Dashboard/></PermissionArea>}/>
      <Route path="/pos" element={<PermissionArea permission="pos.access"><POS/></PermissionArea>}/>
      <Route path="/pedidos" element={<Navigate to="/pos" replace/>}/>
      <Route path="/ventas" element={<PermissionArea permission="sales.view"><Sales/></PermissionArea>}/>
      <Route path="/clientes" element={<PermissionArea permission="customers.manage"><Customers/></PermissionArea>}/>
      <Route path="/productos" element={<Navigate to="/configuraciones" replace/>}/>
      <Route path="/reportes" element={<PermissionArea permission="reports.view"><Reports/></PermissionArea>}/>
      <Route path="/usuarios" element={<Navigate to="/configuraciones" replace/>}/>
      <Route path="/cierre-caja" element={<PermissionArea permission="cashClosing.access"><CashClosing/></PermissionArea>}/>
      <Route path="/configuraciones" element={<ManagementArea><Settings/></ManagementArea>}/>
      <Route path="/inventario" element={<Navigate to="/productos" replace/>}/>
      <Route path="*" element={<Navigate to="/pos" replace/>}/>
    </Route>
  </Routes></BrowserRouter></AppErrorBoundary>
}
