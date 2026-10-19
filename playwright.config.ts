import { defineConfig, devices } from '@playwright/test'

const URL_BASE = 'http://127.0.0.1:8788'
// Fase 4: segundo site (ivo-novo), servido de dist-novo ao lado do app atual.
const URL_NOVO = 'http://127.0.0.1:8789'
const SO_NOVO = /[\\/]novo-[^\\/]*\.spec\.ts$/

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Local (Windows): menos workers e folga na primeira rota lazy; no CI nada muda.
  workers: process.env.CI ? undefined : 2,
  expect: { timeout: process.env.CI ? 5_000 : 15_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: URL_BASE, trace: 'retain-on-failure' },
  projects: [
    { name: 'celular', testIgnore: [/[\\/]real[\\/]/, SO_NOVO], use: { ...devices['Pixel 7'] } },
    // Fase 4: o segundo site (ivo-novo), servido de dist-novo (npm run build:novo:test).
    { name: 'novo', testMatch: SO_NOVO, use: { ...devices['Pixel 7'], baseURL: URL_NOVO } },
    // Toque no iPhone (viewport, user agent e touch do iPhone 15). Só o Chromium está instalado no CI: o motor é o
    // Chromium com o perfil do aparelho (o WebKit de verdade fica para o teste manual no aparelho).
    {
      name: 'iphone',
      testMatch: /toque-.*\.spec\.ts$/,
      use: { ...devices['iPhone 15'], defaultBrowserType: 'chromium' },
    },
    // Fluxos contra o Supabase real (CI): exigem E2E_BACKEND_REAL=1 e o .env.test; sem Docker local, ficam de fora.
    ...(process.env.E2E_BACKEND_REAL === '1'
      ? [{ name: 'real', testMatch: /[\\/]real[\\/].*\.spec\.ts$/, fullyParallel: false, use: { ...devices['Pixel 7'] } }]
      : []),
  ],
  // wrangler pages dev aplica o _headers igual ao Cloudflare Pages.
  webServer: [
    {
      command: 'npx wrangler pages dev dist --port 8788 --ip 127.0.0.1 --compatibility-date=2026-09-01',
      url: URL_BASE,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { WRANGLER_SEND_METRICS: 'false' },
    },
    {
      command:
        'npx wrangler pages dev dist-novo --port 8789 --ip 127.0.0.1 --inspector-port 9230 --compatibility-date=2026-09-01',
      url: URL_NOVO,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { WRANGLER_SEND_METRICS: 'false' },
    },
  ],
})
