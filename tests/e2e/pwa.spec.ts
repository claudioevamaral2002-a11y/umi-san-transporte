import { expect, test } from '@playwright/test'

test('manifest instalável', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({ name: 'Umi San Transporte', display: 'standalone', lang: 'pt-BR', start_url: '/' })
  const icones = manifest.icons as Array<{ sizes: string; purpose?: string }>
  expect(icones.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(icones.some((i) => i.purpose === 'maskable')).toBe(true)
})

test('service worker controla a página e o app abre offline', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Umi San Transporte' })).toBeVisible()
})
