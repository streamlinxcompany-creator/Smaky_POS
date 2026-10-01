import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
