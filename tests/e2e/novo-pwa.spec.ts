// Segundo site (ivo-novo): PWA próprio, mesma CSP do app atual e aviso de nova versão.
// Roda no projeto Playwright `novo`, que serve dist-novo (npm run build:novo:test).
import { expect, test, type Page } from '@playwright/test'
import { vigiarCsp } from './apoio/apiFalsa.ts'

/** O app atual (projeto `celular`), servido ao lado. */
const ORIGEM_APP_ATUAL = 'http://127.0.0.1:8788'

/** Espera o SW atual controlar a página (no modo `prompt` não há clientsClaim: assume na recarga). */
async function comServiceWorkerAtivo(page: Page) {
  await page.goto('/entrar')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
}

test('manifesto próprio da v2', async ({ request }) => {
  const manifesto = await (await request.get('/manifest.webmanifest')).json()
  expect(manifesto).toMatchObject({
    name: 'IVO Transportes',
    short_name: 'IVO',
    display: 'standalone',
    lang: 'pt-BR',
    start_url: '/',
  })
})

test('mesma CSP do app atual e nenhuma violação na entrada', async ({ page, request }) => {
  const cspAtual = (await request.get(`${ORIGEM_APP_ATUAL}/entrar`)).headers()['content-security-policy']
  expect(cspAtual).toContain("script-src 'self'")
  const violacoes = await vigiarCsp(page)
  const resposta = await page.goto('/entrar')
  expect(resposta?.headers()['content-security-policy']).toBe(cspAtual)
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  // O registro do SW sai do bundle (nenhum script inline): a página fica sob o SW sem violar a CSP.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  expect(violacoes).toEqual([])
})

test('SW novo esperando mostra "Nova versão · Atualizar", e o botão o ativa', async ({ page }) => {
  await comServiceWorkerAtivo(page)
  const aviso = page.getByRole('button', { name: 'Nova versão · Atualizar' })
  await expect(aviso).toHaveCount(0)

  // Simula um deploy novo: outro script de SW no mesmo escopo. O navegador o instala e, sem skipWaiting
  // (registerType 'prompt'), ele fica esperando, como o sw.js de um deploy novo. (O Playwright não intercepta
  // o download do script do SW, então não dá para trocar o corpo do /sw.js.) Para o workbox-window é um SW
  // "externo", o mesmo caminho de uma atualização achada depois do primeiro minuto do app aberto.
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js?deploy=novo', { scope: '/' })
  })

  await expect(aviso).toBeVisible()
  await page.evaluate(() => ((window as unknown as { __shellAntigo: boolean }).__shellAntigo = true))
  await aviso.click()

  // O SW que esperava assume e a página recarrega no shell novo.
  await expect
    .poll(() =>
      page
        .evaluate(() => ({
          recarregou: !(window as unknown as { __shellAntigo?: boolean }).__shellAntigo,
          controlador: navigator.serviceWorker.controller?.scriptURL ?? '',
        }))
        .catch(() => ({ recarregou: false, controlador: '' })),
    )
    .toEqual({ recarregou: true, controlador: expect.stringContaining('/sw.js?deploy=novo') })
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  // Sem checar o aviso depois da recarga: o app registra de novo o /sw.js, que para o navegador é outro
  // script (o ativo agora é o ?deploy=novo) e vira outra versão esperando, coisa só da simulação.
})
