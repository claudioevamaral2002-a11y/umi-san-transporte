import { expect, test } from '@playwright/test'

test('manifest instalável', async ({ request }) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json()
  expect(manifest).toMatchObject({ name: 'IVO Transportes v1', short_name: 'IVO v1', display: 'standalone', lang: 'pt-BR', start_url: '/' })
  const icones = manifest.icons as Array<{ sizes: string; purpose?: string }>
  expect(icones.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(icones.some((i) => i.purpose === 'maskable')).toBe(true)
})

test('service worker controla a página e o app abre offline (tela de entrada)', async ({ page, context }) => {
  await page.goto('/entrar')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  await expect(page.getByLabel('E-mail')).toBeVisible()
})

test('sw.js: atualização imediata e navegação sempre pela rede primeiro', async ({ request }) => {
  const resposta = await request.get('/sw.js')
  expect(resposta.headers()['cache-control']).toContain('no-cache')
  const sw = await resposta.text()
  expect(sw).toContain('skipWaiting')
  expect(sw).toContain('clientsClaim')
  expect(sw).toMatch(/cleanupOutdatedCaches|cleanupOutdatedCaches\(\)/)
  expect(sw).toContain('NetworkFirst')
  expect(sw).toContain('networkTimeoutSeconds:3')
  expect(sw).toContain('"navigate"')
  // Sem NavigationRoute do precache (ele serviria um shell velho para links de acesso).
  expect(sw).not.toContain('NavigationRoute')
  for (const caminho of ['/', '/index.html', '/registerSW.js']) {
    expect((await request.get(caminho)).headers()['cache-control']).toContain('no-cache')
  }
})

test('com o SW ativo, navegar para /definir-senha busca o documento na rede', async ({ page, context }) => {
  await page.goto('/entrar')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  const pedidos: string[] = []
  context.on('request', (r) => {
    if (r.isNavigationRequest() || r.url().endsWith('/definir-senha')) pedidos.push(r.url())
  })
  await page.goto('/definir-senha#access_token=falso&type=invite')
  await expect.poll(() => pedidos.some((u) => u.endsWith('/definir-senha'))).toBe(true)
  // Sem sessão válida a guarda leva à entrada: o shell novo rodou, nunca um 404 do roteador.
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0)
  await expect(page.getByText('Página não encontrada')).toHaveCount(0)
})

test('tela de erro geral é da marca e "Recarregar" limpa os caches', async ({ page }) => {
  await page.goto('/entrar')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.goto('/erro-teste')
  await expect(page.getByRole('heading', { name: 'Algo deu errado' })).toBeVisible()
  await expect(page.getByText('Unexpected Application Error')).toHaveCount(0)
  await page.evaluate(() => caches.open('lixo-de-teste'))
  await page.getByRole('button', { name: 'Recarregar' }).click()
  // O botão apaga os caches e recarrega: durante a recarga o contexto da página some; a leitura tenta de novo.
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).includes('lixo-de-teste')).catch(() => true))
    .toBe(false)
})
