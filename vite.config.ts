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
      pwaAssets: { config: true },
      manifest: {
        name: 'Umi San Transporte',
        short_name: 'Umi San',
        description: 'Agendamento, orçamento e execução de transportes.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0B2545',
        theme_color: '#0B2545',
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
      },
    }),
  ],
})
