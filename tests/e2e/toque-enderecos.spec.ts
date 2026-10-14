// Fase 3A, por TOQUE (hasTouch + tap), em Pixel e iPhone, nos temas claro e escuro: "Marcar no mapa" para portos e
// marinas sem endereço. Google e blocos do mapa simulados; nenhuma violação de CSP (Leaflet sem script externo).
import { expect, test, type Page } from '@playwright/test'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { escolherDiaNoPedido } from './apoio/escolherDia.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import { DIA_PEDIDO, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

async function abrirOnde(page: Page) {
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  const pedidos = await simularPedidos(page)
  await simularMapas(page)
  const blocos = await simularBlocosDoMapa(page)
  await page.goto('/pedidos/novo')
  await escolherDiaNoPedido(page, DIA_PEDIDO, 'tap')
  await page.getByTestId('horarios-livres').getByRole('radio', { name: '10:00' }).tap()
  await page.getByRole('button', { name: 'Continuar' }).tap()
  await expect(page.getByRole('heading', { level: 1, name: 'Onde?' })).toBeVisible()
  return { pedidos, blocos }
}

for (const tema of ['light', 'dark'] as const) {
  test.describe(`marcar no mapa, tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema, hasTouch: true })

    test('toque em "Marcar no mapa", arrasta o mapa, dá nome e usa o ponto', async ({ page }) => {
      const csp = await vigiarCsp(page)
      const { blocos } = await abrirOnde(page)
      const destino = page.getByRole('combobox', { name: 'Destino' })
      await destino.tap()
      await destino.fill('marina')
      await page.getByRole('option', { name: 'Não achou? Marcar no mapa' }).tap()

      const folha = page.getByRole('dialog', { name: 'Marcar no mapa' })
      await expect(folha).toBeVisible()
      const mapa = folha.getByTestId('mapa')
      await expect(mapa).toHaveAttribute('data-pronto', 'sim')
      await expect(mapa).toHaveAttribute('data-animacao', 'sim')
      expect(blocos.sessao).toBe(1)
      await expect.poll(() => blocos.blocos).toBeGreaterThan(0)
      // Pino fixo com o triângulo da marca na ponta e a atribuição do Google.
      await expect(folha.locator('[data-testid="pino"] path[fill="var(--cor-laranja)"]')).toHaveCount(1)
      await expect(folha.getByText('Google', { exact: true })).toBeVisible()
      await expect(folha.getByText('Mova o mapa até a ponta do triângulo ficar no lugar certo.')).toBeVisible()

      // Arrasta o mapa: o centro muda.
      const antes = await mapa.getAttribute('data-centro')
      const caixa = (await mapa.boundingBox())!
      const x = caixa.x + caixa.width / 2
      const y = caixa.y + caixa.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x - 80, y - 60, { steps: 8 })
      await page.mouse.up()
      await expect(mapa).not.toHaveAttribute('data-centro', antes ?? '')

      await folha.getByRole('button', { name: 'Usar este ponto' }).tap()
      await expect(folha.getByText('Dê um nome ao local (de 3 a 200 caracteres).')).toBeVisible()
      await folha.getByLabel('Nome do local').fill('Marina Itajaí, rampa 2')
      await folha.getByRole('button', { name: 'Usar este ponto' }).tap()
      await expect(folha).toBeHidden()
      await expect(destino).toHaveValue('Marina Itajaí, rampa 2')
      expect(csp).toEqual([])
    })
  })
}

test.describe('marcar no mapa com movimento reduzido', () => {
  test.use({ hasTouch: true, reducedMotion: 'reduce' })

  test('o mapa não anima', async ({ page }) => {
    await abrirOnde(page)
    await page.getByRole('combobox', { name: 'Origem' }).tap()
    await page.getByRole('option', { name: 'Não achou? Marcar no mapa' }).tap()
    const mapa = page.getByRole('dialog', { name: 'Marcar no mapa' }).getByTestId('mapa')
    await expect(mapa).toHaveAttribute('data-pronto', 'sim')
    await expect(mapa).toHaveAttribute('data-animacao', 'nao')
  })
})

test.describe('mapa indisponível', () => {
  test.use({ hasTouch: true })

  test('sem sessão de blocos: aviso e o campo segue como texto livre', async ({ page }) => {
    await abrirOnde(page)
    await page.route('https://tile.googleapis.com/**', (route) => route.fulfill({ status: 403, body: '{}' }))
    await page.getByRole('combobox', { name: 'Origem' }).tap()
    await page.getByRole('option', { name: 'Não achou? Marcar no mapa' }).tap()
    const folha = page.getByRole('dialog', { name: 'Marcar no mapa' })
    await expect(folha.getByText('O mapa não está disponível agora. Escreva o local; o motorista confere os km.')).toBeVisible()
    await expect(folha.getByRole('button', { name: 'Usar este ponto' })).toHaveCount(0)
  })
})
