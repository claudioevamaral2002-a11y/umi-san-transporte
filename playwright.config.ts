import { defineConfig, devices } from '@playwright/test'

const URL_BASE = 'http://127.0.0.1:8788'

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: URL_BASE, trace: 'retain-on-failure' },
  projects: [{ name: 'celular', use: { ...devices['Pixel 7'] } }],
  // wrangler pages dev aplica o _headers igual ao Cloudflare Pages.
  webServer: {
    command: 'npx wrangler pages dev dist --port 8788 --ip 127.0.0.1',
    url: URL_BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
})
