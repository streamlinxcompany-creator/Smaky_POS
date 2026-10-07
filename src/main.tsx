import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { seed } from './lib/store'
import { clearSession, getSessionUser, validateRemoteSession } from './lib/auth'
import { startSync, withSyncSuppressed } from './lib/sync'
import './styles/global.css'

// IMPORTANT: render React immediately.
// The previous bootstrap waited for IndexedDB seed + Supabase session validation
// before creating the React root. If either operation stalled, #root remained
// empty and the published page appeared as a completely black screen.
const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Smaky: no se encontró #root.')

const root = createRoot(rootElement)
root.render(
  <StrictMode><App /></StrictMode>
)

startSync()

async function bootstrapInBackground() {
  try {
    await withSyncSuppressed(() => Promise.race([
      seed(),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error('La inicialización local tardó demasiado.')), 8_000)
      ),
    ]))
  } catch (error) {
    console.error('Smaky: error inicializando datos locales:', error)
  } finally {
    // Login can refresh its user list when seed finishes.
    window.dispatchEvent(new Event('smaky-data-ready'))
  }

  try {
    if (getSessionUser()?.id === 'u-demo-worker') clearSession()
    // Do not let a stalled Supabase session check block or blank the application.
    await Promise.race([
      validateRemoteSession(),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error('La validación de sesión tardó demasiado.')), 8_000)
      ),
    ])
  } catch (error) {
    console.error('Smaky: error validando la sesión inicial:', error)
  }
}

void bootstrapInBackground()
