import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'

function copyRootStreamLinxLogo(): Plugin {
  const syncLogo = (root: string) => {
    const source = path.resolve(root, 'Streamlinx.png')
    if (!fs.existsSync(source)) return
    const publicDir = path.resolve(root, 'public')
    const target = path.join(publicDir, 'Streamlinx.png')
    fs.mkdirSync(publicDir, { recursive: true })
    fs.copyFileSync(source, target)
  }
  return {
    name: 'copy-streamlinx-logo',
    buildStart() { syncLogo(process.cwd()) },
    configureServer(server) {
      syncLogo(server.config.root)
    }
  }
}

export default defineConfig({
  plugins: [
    react(),
    copyRootStreamLinxLogo(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Smaky POS',
        short_name: 'Smaky POS',
        description: 'POS y control de negocio para Smaky Burgers',
        theme_color: '#0a0a0a',
        background_color: '#0a0a0a',
        display: 'standalone',
        lang: 'es-CO',
        icons: []
      },
      workbox: {
        navigateFallback: '/index.html'
      }
    })
  ]
})
