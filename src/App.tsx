import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { POS } from './pages/POS'
import { Products } from './pages/Products'
import { Sales } from './pages/Sales'
import { Reports } from './pages/Reports'
import { CashClosing } from './pages/CashClosing'
import { Login } from './pages/Login'
import { getSessionUser, hasPermission } from './lib/auth'
import type { PermissionKey } from './lib/types'
import { StreamLinx } from './pages/StreamLinx'
import { Settings } from './pages/Settings'

function PermissionArea({ permission, children, fallback = '/' }: { permission: PermissionKey; children: ReactNode; fallback?: string }) {
  const user = getSessionUser()
  return user && hasPermission(user, permission) ? children : <Navigate to={fallback} replace />
}

function ManagementArea({ children }: { children: ReactNode }) {
  const user = getSessionUser()
  return user && ['manager', 'admin'].includes(user.role) ? children : <Navigate to="/pos" replace />
}

export default function App() {
  return <BrowserRouter><Routes>
    <Route path="/login" element={<Login/>}/>
    <Route path="/streamlinx" element={<StreamLinx/>}/>
    <Route element={<Layout/>}>
      <Route path="/" element={<PermissionArea permission="dashboard.view" fallback="/pos"><Dashboard/></PermissionArea>}/>
      <Route path="/pos" element={<PermissionArea permission="pos.access"><POS/></PermissionArea>}/>
      <Route path="/pedidos" element={<Navigate to="/pos" replace/>}/>
      <Route path="/ventas" element={<PermissionArea permission="sales.view"><Sales/></PermissionArea>}/>
      <Route path="/productos" element={<PermissionArea permission="products.manage"><Products/></PermissionArea>}/>
      <Route path="/reportes" element={<PermissionArea permission="reports.view"><Reports/></PermissionArea>}/>
      <Route path="/usuarios" element={<Navigate to="/configuraciones" replace/>}/>
      <Route path="/cierre-caja" element={<PermissionArea permission="cashClosing.access"><CashClosing/></PermissionArea>}/>
      <Route path="/configuraciones" element={<ManagementArea><Settings/></ManagementArea>}/>
      <Route path="/inventario" element={<Navigate to="/productos" replace/>}/>
      <Route path="*" element={<Navigate to="/pos" replace/>}/>
    </Route>
  </Routes></BrowserRouter>
}
