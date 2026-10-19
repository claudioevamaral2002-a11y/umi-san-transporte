import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Fase 4: `--mode novo` gera o segundo site (ivo-novo) em dist-novo, a partir de novo.html (src/novo).
// Os demais modos geram o app atual em dist, como sempre.
export default defineConfig(({ mode }) => {
  const novo = mode === 'novo'
  return {
    // Vitrine do design system só em dev e na build de teste do e2e; a de produção nunca a inclui.
    define: { 'import.meta.env.VITE_VITRINE': JSON.stringify(mode === 'test' || mode === 'development' ? '1' : '') },
    // Sem polyfill inline e sem assets em data: — a CSP só permite 'self'.
    build: {
      modulePreload: { polyfill: false },
      assetsInlineLimit: 0,
      ...(novo && { outDir: 'dist-novo', rollupOptions: { input: 'novo.html' } }),
    },
    plugins: [
      react(),
      tailwindcss(),
      // O Pages serve /index.html para as rotas do SPA (e o SW usa a chave /index.html): novo.html sai com esse nome.
      novo && {
        name: 'novo-html-como-index',
        enforce: 'post' as const,
        generateBundle(_opcoes: unknown, bundle: Record<string, { fileName: string }>) {
          const html = bundle['novo.html']
          if (html) html.fileName = 'index.html'
        },
      },
      VitePWA({
        // App atual: o SW novo assume sozinho. App novo: espera o toque em "Nova versão · Atualizar".
        registerType: novo ? 'prompt' : 'autoUpdate',
        // App atual: registro por arquivo externo (registerSW.js). App novo: o registro vai no bundle
        // (useRegisterSW, em src/novo/AvisoNovaVersao.tsx). Nenhum script inline nos dois.
        injectRegister: novo ? false : 'script',
        manifest: {
          name: novo ? 'IVO Transportes (novo)' : 'IVO Transportes',
          short_name: novo ? 'IVO novo' : 'IVO',
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
          // App atual: deploy novo vale já, o SW novo ativa e assume as abas abertas. App novo: o SW novo
          // espera o SKIP_WAITING do botão "Atualizar". Nos dois, os precaches antigos somem.
          skipWaiting: !novo,
          clientsClaim: !novo,
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
  }
})
