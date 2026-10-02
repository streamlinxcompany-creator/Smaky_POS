import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { POS } from './pages/POS'
import { Products } from './pages/Products'
import { Sales } from './pages/Sales'
import { Reports } from './pages/Reports'
import { Users } from './pages/Users'
import { CashClosing } from './pages/CashClosing'
import { Login } from './pages/Login'
import { getSessionUser } from './lib/auth'
import { StreamLinx } from './pages/StreamLinx'
import { Settings } from './pages/Settings'

function AdminArea({ children }: { children: ReactNode }) {
  return getSessionUser()?.role !== 'employee' ? children : <Navigate to="/" replace />
}

export default function App() {
  return <BrowserRouter><Routes>
    <Route path="/login" element={<Login/>}/>
    <Route path="/streamlinx" element={<StreamLinx/>}/>
    <Route element={<Layout/>}>
      <Route path="/" element={<Dashboard/>}/>
      <Route path="/pos" element={<POS/>}/>
      <Route path="/pedidos" element={<Navigate to="/pos" replace/>}/>
      <Route path="/ventas" element={<Sales/>}/>
      <Route path="/productos" element={<AdminArea><Products/></AdminArea>}/>
      <Route path="/reportes" element={<AdminArea><Reports/></AdminArea>}/>
      <Route path="/usuarios" element={<AdminArea><Users/></AdminArea>}/>
      <Route path="/cierre-caja" element={<CashClosing/>}/>
      <Route path="/configuraciones" element={<AdminArea><Settings/></AdminArea>}/>
      <Route path="/inventario" element={<Navigate to="/productos" replace/>}/>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Route>
  </Routes></BrowserRouter>
}
