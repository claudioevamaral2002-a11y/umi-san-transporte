import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

// Versão mostrada em Perfil e segurança na v2 (a do package.json).
const VERSAO: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

// `--mode novo` gera a v2 (src/novo, a partir de novo.html) em dist-novo: vai para o endereço principal e para o
// ivo-novo. Os demais modos geram a v1 (o app anterior) em dist, publicada em ivo-v1.
export default defineConfig(({ mode }) => {
  const novo = mode === 'novo'
  return {
    // Vitrine do design system só em dev e na build de teste do e2e; a de produção nunca a inclui.
    define: {
      'import.meta.env.VITE_VITRINE': JSON.stringify(mode === 'test' || mode === 'development' ? '1' : ''),
      'import.meta.env.VITE_VERSAO': JSON.stringify(VERSAO),
    },
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
          name: novo ? 'IVO Transportes' : 'IVO Transportes v1',
          short_name: novo ? 'IVO' : 'IVO v1',
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
          globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,wav}'],
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
