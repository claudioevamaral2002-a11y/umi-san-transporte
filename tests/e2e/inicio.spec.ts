// Início, pedidos e detalhe no redesign: saldo num bloco marinho único, só "Aguardando você" com borda laranja,
// rota terminando no triângulo da marca e etapa atual marcada por ele.
import { expect, test, type Page } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { saldoFalso, simularDinheiro } from './apoio/dinheiroFalso.ts'
import { ID_PEDIDO, pedidoOrcadoCliente, pendenciaFalsa, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

const N2 = { papel: 'CLIENTE' as const, nivel: 2 as const, nome: 'Diego Rocha', empresa_nome: 'Umi San' }

/** Elementos dentro de `main` com borda laranja (#FF6A00) visível. */
const comBordaLaranja = (page: Page) =>
  page.locator('main').evaluate((m) =>
    [...m.querySelectorAll('*')].filter((e) => {
      const c = getComputedStyle(e)
      return c.borderTopColor === 'rgb(255, 106, 0)' && parseFloat(c.borderTopWidth) > 0
    }).length,
  )

test('início do cliente: saudação, saldo em bloco marinho e só "aguardando você" com borda laranja', async ({ page }) => {
  await comSessaoFalsa(page, N2)
  await simularApi(page)
  await simularDinheiro(page, { saldos: [saldoFalso({ abaixo_alerta: true })] })
  await simularPedidos(page, {
    pendencias: {
      aguardando_aprovacao: [pendenciaFalsa({ status: 'ORCADA', prazo: new Date(Date.now() + 20 * 3600_000).toISOString(), total_cent: 71000 })],
      aguardando_orcamento: [pendenciaFalsa({ id: 'x', numero: 41, urgente: true })],
    },
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: /^(Bom dia|Boa tarde|Boa noite), Diego$/ })).toBeVisible()
  await expect(page.getByTestId('cartao-saldo')).toHaveCSS('background-color', 'rgb(10, 37, 64)')
  await expect(page.getByTestId('pendencia-aprovar')).toBeVisible()
  await expect(page.getByTestId('pendencia-acompanhar')).toContainText('Urgente')
  expect(await comBordaLaranja(page)).toBe(1)
  await expect(page.getByTestId('pendencia-aprovar')).toHaveCSS('border-top-color', 'rgb(255, 106, 0)')
  await expect(page.locator('main')).not.toContainText('·')
})

test('detalhe: rota termina no triângulo, etapa atual marcada por ele, aprovar diz o valor', async ({ page }) => {
  await comSessaoFalsa(page, N2)
  await simularApi(page)
  await simularDinheiro(page)
  await simularPedidos(page, { detalhes: [pedidoOrcadoCliente()] })
  await page.goto(`/pedidos/${ID_PEDIDO}`)
  const rota = page.getByTestId('rota').first()
  await expect(rota.locator('svg path[fill="var(--cor-laranja)"]')).toHaveCount(1)
  await expect(page.locator('main')).not.toContainText('→')
  await expect(page.getByTestId('linha-do-tempo').locator('[aria-current="step"] svg path[fill="var(--cor-laranja)"]')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^Aprovar R\$/ })).toBeVisible()
})
