import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => ({
  // Vitrine do design system só em dev e na build de teste do e2e; a de produção nunca a inclui.
  define: { 'import.meta.env.VITE_VITRINE': JSON.stringify(mode === 'test' || mode === 'development' ? '1' : '') },
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
        // Deploy novo vale já: o SW novo ativa e assume as abas abertas, e os precaches antigos somem.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico}'],
        // Sem NavigationRoute do precache: um shell velho nunca atende links de acesso
        // (#access_token… não chega ao SW). Toda navegação tenta a rede primeiro.
        navigateFallback: undefined,
        runtimeCaching: [
          {
            urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'navegacao',
              networkTimeoutSeconds: 3,
              plugins: [
                {
                  // Um único shell (SPA): todas as rotas compartilham a chave /index.html.
                  cacheKeyWillBeUsed: async () => '/index.html',
                  // Offline (ou rede lenta sem cache): cai no index.html do precache.
                  handlerDidError: async () => {
                    const resposta = await caches.match('/index.html', { ignoreSearch: true })
                    return resposta ?? Response.error()
                  },
                },
              ],
            },
          },
        ],
      },
    }),
  ],
}))
