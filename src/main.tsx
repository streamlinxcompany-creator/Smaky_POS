import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { seed } from './lib/store'
import { clearSession, getSessionUser, validateRemoteSession } from './lib/auth'
import { startSync, withSyncSuppressed } from './lib/sync'
import './styles/global.css'

startSync()

async function bootstrap() {
  try {
    await withSyncSuppressed(() => seed())
  } catch (error) {
    // Un problema en IndexedDB/seed no debe dejar la aplicación totalmente en
    // blanco. Los módulos individuales podrán mostrar su propio estado/error.
    console.error('Smaky: error inicializando datos locales:', error)
  }

  try {
    if (getSessionUser()?.id === 'u-demo-worker') clearSession()
    await validateRemoteSession()
  } catch (error) {
    console.error('Smaky: error validando la sesión inicial:', error)
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode><App/></StrictMode>
  )
}

void bootstrap()
