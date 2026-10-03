import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { seed } from './lib/store'
import { clearSession, getSessionUser } from './lib/auth'
import './styles/global.css'

seed().then(() => {
  if (getSessionUser()?.id === 'u-demo-worker') clearSession()
  createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
})
