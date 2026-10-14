// 2FA: o código só é pedido quando a SESSÃO no servidor ainda não passou pelo 2FA. Se o aparelho guardou um token
// de acesso anterior ao 2FA (resposta da verificação perdida ao trocar de app, app fechado no meio, outra janela),
// o app renova uma vez e o servidor devolve aal2 — sem pedir o código. Contra o Auth real: tests/e2e/real/sessao-2fa.
import { expect, test } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { comSessaoFalsa, URL_SUPABASE } from './apoio/sessaoFalsa.ts'

test('token guardado aal1 com sessão já verificada no servidor: vai ao Início sem pedir o código', async ({ page }) => {
  await comSessaoFalsa(page, { papel: 'ADM', nome: 'Alice Souza', tem_2fa: true }, { aal: 'aal1', aalNaRenovacao: 'aal2' })
  await simularApi(page)
  const renovacoes: string[] = []
  page.on('request', (r) => {
    if (r.url().startsWith(`${URL_SUPABASE}/auth/v1/token?grant_type=refresh_token`)) renovacoes.push(r.url())
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Alice$/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Digite o código' })).toHaveCount(0)
  expect(renovacoes).toHaveLength(1)
  // Recarregar: o token guardado agora é aal2, nada de renovar de novo.
  await page.reload()
  await expect(page.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Alice$/ })).toBeVisible()
  expect(renovacoes).toHaveLength(1)
})

test('login novo (sessão aal1 no servidor): pede o código, renovando uma vez só', async ({ page }) => {
  await comSessaoFalsa(page, { papel: 'ADM', tem_2fa: true }, { aal: 'aal1' })
  const renovacoes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('grant_type=refresh_token')) renovacoes.push(r.url())
  })
  await page.goto('/')
  await expect(page).toHaveURL(/\/seguranca\/2fa$/)
  await expect(page.getByRole('heading', { name: 'Digite o código' })).toBeVisible()
  await page.waitForTimeout(1500)
  expect(renovacoes).toHaveLength(1)
})
