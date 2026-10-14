// Agenda estilo Lark no celular, por TOQUE, em Pixel e iPhone, nos temas claro e escuro: visões Dia, 3 dias e Mês,
// linha do "agora" com o triângulo da marca, janela livre que abre o pedido e seleção visível nos dois modos.
import { expect, test, type Page } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { esperarDestacado } from './apoio/contraste.ts'
import { escolherDiaNaAgenda } from './apoio/escolherDia.ts'
import { DIA_PEDIDO, diaSp, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

async function abrirAgenda(page: Page) {
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  await simularPedidos(page)
  await page.goto('/agenda')
  await expect(page.getByTestId('faixa-semana').locator('[data-dia]').first()).toBeVisible()
}

const visao = (page: Page) => page.getByRole('radiogroup', { name: 'Visualização' })

for (const tema of ['light', 'dark'] as const) {
  test.describe(`agenda, tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema, hasTouch: true })

    test('Dia: abre em hoje com a linha do agora e o triângulo; livre abre o pedido', async ({ page }) => {
      await abrirAgenda(page)
      await expect(visao(page).getByRole('radio', { checked: true })).toHaveText('Dia')
      await expect(page.getByTestId('faixa-semana').locator(`[data-dia="${diaSp(0)}"]`)).toHaveAttribute('aria-pressed', 'true')
      const agora = page.getByTestId('linha-agora')
      await expect(agora).toBeVisible()
      await expect(agora.locator('svg path')).toHaveAttribute('fill', 'var(--cor-laranja)')
      await expect(agora).toHaveCSS('background-color', 'rgb(255, 106, 0)')

      await escolherDiaNaAgenda(page, DIA_PEDIDO, 'tap')
      await expect(page.getByTestId('linha-agora')).toHaveCount(0)
      await expect(page.getByTestId('bloco-proprio')).toContainText('Pedido #0042')
      await page.getByTestId('janela-livre').first().tap()
      await expect(page).toHaveURL(/\/pedidos\/novo\?inicio=/)
    })

    test('seletor e dia escolhido se destacam; 3 dias mostra três colunas', async ({ page }) => {
      await abrirAgenda(page)
      const tres = visao(page).getByRole('radio', { name: '3 dias' })
      await tres.tap()
      await expect(tres).toHaveAttribute('aria-checked', 'true')
      await esperarDestacado(tres)
      await expect(page.getByTestId('grade-horas').locator('[data-coluna-dia]')).toHaveCount(3)
      const dia = await escolherDiaNaAgenda(page, DIA_PEDIDO, 'tap')
      await esperarDestacado(dia)
      await expect(page.getByTestId('grade-horas').locator('[data-coluna-dia]').first()).toHaveAttribute('data-coluna-dia', DIA_PEDIDO)
    })

    test('dia tocado na 2ª semana continua visível na faixa; bloco mostra o status em texto', async ({ page }) => {
      await abrirAgenda(page)
      const faixa = page.getByTestId('faixa-semana')
      const dia = (await faixa.locator('[data-dia]').nth(10).getAttribute('data-dia'))!
      const alvo = faixa.locator(`[data-dia="${dia}"]`)
      await alvo.scrollIntoViewIfNeeded()
      await alvo.tap()
      await expect(alvo).toHaveAttribute('aria-pressed', 'true')
      // Depois de re-renderizar, o dia escolhido segue dentro da área visível da faixa.
      await expect
        .poll(async () => {
          const f = (await faixa.boundingBox())!
          const b = (await faixa.locator('[aria-pressed="true"]').boundingBox())!
          return b.x >= f.x - 1 && b.x + b.width <= f.x + f.width + 1
        })
        .toBe(true)
      await escolherDiaNaAgenda(page, DIA_PEDIDO, 'tap')
      await expect(page.getByTestId('bloco-proprio')).toContainText('Solicitada')
    })

    test('Mês: legenda logo abaixo e resumo do dia tocado; Hoje volta para hoje', async ({ page }) => {
      await abrirAgenda(page)
      await visao(page).getByRole('radio', { name: 'Mês' }).tap()
      await expect(page.getByTestId('calendario')).toBeVisible()
      await expect(page.getByTestId('legenda-calendario')).toBeVisible()
      // Hoje (não escolhido) fica em laranja-texto: #C2410C no claro, #FF8A4C no escuro.
      await page.getByTestId('calendario').locator(`[data-dia="${DIA_PEDIDO}"]`).tap()
      await expect(page.getByTestId('calendario').locator(`[data-dia="${diaSp(0)}"]`)).toHaveCSS(
        'color',
        tema === 'light' ? 'rgb(194, 65, 12)' : 'rgb(255, 138, 76)',
      )
      await page.getByTestId('calendario').locator(`[data-dia="${DIA_PEDIDO}"]`).tap()
      const resumo = page.getByTestId('resumo-dia')
      await expect(resumo).toContainText('Pedido #0042')
      await resumo.getByRole('button', { name: 'Abrir o dia' }).tap()
      await expect(visao(page).getByRole('radio', { checked: true })).toHaveText('Dia')
      await page.getByRole('button', { name: 'Hoje' }).tap()
      await expect(page.getByTestId('faixa-semana').locator(`[data-dia="${diaSp(0)}"]`)).toHaveAttribute('aria-pressed', 'true')
    })
  })
}
