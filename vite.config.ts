import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Sem polyfill inline e sem assets em data: — a CSP só permite 'self'.
  build: { modulePreload: { polyfill: false }, assetsInlineLimit: 0 },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registro por arquivo externo (registerSW.js): nenhum script inline.
      injectRegister: 'script',
      manifest: {
        name: 'IVO Transportes',
        short_name: 'IVO',
        description: 'Agendamento, orçamento e execução de transportes.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0A2540',
        theme_color: '#0A2540',
        icons: [
          { src: '/ivo-icon-escuro-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/ivo-icon-escuro-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/ivo-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
      },
    }),
  ],
})
