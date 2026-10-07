import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { seed } from './lib/store'
import { clearSession, getSessionUser, validateRemoteSession } from './lib/auth'
import { startSync, withSyncSuppressed } from './lib/sync'
import './styles/global.css'

startSync()
withSyncSuppressed(() => seed()).then(async () => {
  if (getSessionUser()?.id === 'u-demo-worker') clearSession()
  await validateRemoteSession()
  createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
})
