// Novo pedido no celular, por TOQUE (hasTouch + tap), em Pixel e iPhone, nos temas claro e escuro.
// Bug de produção: o toque mudava a seleção, mas no tema escuro o dia/horário escolhido ficava com a mesma cor
// da superfície (marinho sobre marinho) — parecia que nada tinha sido selecionado.
import { expect, test, type Page } from '@playwright/test'
import { contraste, esperarDestacado, fundo } from './apoio/contraste.ts'
import { simularApi } from './apoio/apiFalsa.ts'
import { DIA_PEDIDO, diaSp, simularPedidos } from './apoio/pedidosFalsos.ts'
import { escolherDiaNoPedido } from './apoio/escolherDia.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

async function abrir(page: Page) {
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  const chamadas = await simularPedidos(page)
  await page.goto('/pedidos/novo')
  await expect(page.getByTestId('faixa-dias').locator('[data-dia]').first()).toBeVisible()
  return chamadas
}

const tocarDia = (page: Page, dia: string) => escolherDiaNoPedido(page, dia, 'tap')

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema, hasTouch: true })

    test('toque escolhe o dia, troca o horário e ajusta a duração — e a escolha aparece', async ({ page }) => {
      const chamadas = await abrir(page)

      // Dia: toque seleciona e destaca; outro toque move a seleção.
      const dia = await tocarDia(page, DIA_PEDIDO)
      await expect(dia).toHaveAttribute('aria-pressed', 'true')
      await esperarDestacado(dia)
      const outroDia = await tocarDia(page, diaSp(4))
      await expect(outroDia).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('faixa-dias').locator(`[data-dia="${DIA_PEDIDO}"]`)).toHaveAttribute('aria-pressed', 'false')
      await esperarDestacado(outroDia)

      // Horário: toque marca, outro toque troca; só um marcado, e ele se destaca dos demais.
      const horarios = page.getByTestId('horarios-livres')
      await horarios.getByRole('radio', { name: '10:00' }).tap()
      await expect(horarios.getByRole('radio', { name: '10:00' })).toHaveAttribute('aria-checked', 'true')
      await horarios.getByRole('radio', { name: '16:30' }).tap()
      const marcado = horarios.getByRole('radio', { name: '16:30' })
      await expect(marcado).toHaveAttribute('aria-checked', 'true')
      await expect(horarios.getByRole('radio', { checked: true })).toHaveCount(1)
      await esperarDestacado(marcado)
      const livre = horarios.getByRole('radio', { name: '10:00' })
      expect(contraste(await fundo(marcado), await fundo(livre))).toBeGreaterThanOrEqual(3)

      // Duração: + e − por toque (refaz as consultas com a nova duração) e a hora escolhida continua.
      const duracao = page.getByRole('group', { name: 'Duração estimada' })
      await page.getByRole('button', { name: 'Aumentar duração estimada' }).tap()
      await expect(duracao).toContainText('2 h 30 min')
      await page.getByRole('button', { name: 'Aumentar duração estimada' }).tap()
      await expect(duracao).toContainText('3 h')
      await page.getByRole('button', { name: 'Diminuir duração estimada' }).tap()
      await expect(duracao).toContainText('2 h 30 min')
      await expect.poll(() => chamadas.some((c) => c.rpc === 'horarios_livres' && c.corpo.p_duracao_min === 150)).toBe(true)
      await expect(horarios.getByRole('radio', { name: '16:30' })).toHaveAttribute('aria-checked', 'true')

      // Segue para o passo 2 com a escolha feita.
      await page.getByRole('button', { name: 'Continuar' }).tap()
      await expect(page.getByRole('heading', { level: 1, name: 'Onde?' })).toBeVisible()
    })

    test('escolhido usa contorno laranja e nenhum ✓; ocupado aparece riscado; frase confirma', async ({ page }) => {
      await abrir(page)
      await tocarDia(page, DIA_PEDIDO)
      const horarios = page.getByTestId('horarios-livres')
      const marcado = horarios.getByRole('radio', { name: '10:00' })
      await marcado.tap()
      await expect(marcado).toHaveAttribute('aria-checked', 'true')
      expect(await marcado.evaluate((e) => getComputedStyle(e).boxShadow)).toContain('rgb(255, 106, 0)')
      await expect(page.getByTestId('passo-quando')).not.toContainText('✓')
      // 11:30 fica entre livres (11:00 e 16:00): ocupado, riscado e não escolhível.
      const ocupado = horarios.getByRole('radio', { name: '11:30, ocupado' })
      await expect(ocupado).toHaveAttribute('aria-disabled', 'true')
      expect(await ocupado.evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe('line-through')
      await ocupado.tap({ force: true })
      await expect(marcado).toHaveAttribute('aria-checked', 'true')
      await expect(page.getByTestId('frase-quando')).toHaveText(/, das 10:00 às 12:00$/)
    })

    test('opções do passo 3 (tipo, modalidade) e Levar/Trazer se destacam ao toque', async ({ page }) => {
      await abrir(page)
      await tocarDia(page, DIA_PEDIDO)
      await page.getByTestId('horarios-livres').getByRole('radio', { name: '10:00' }).tap()
      await page.getByRole('button', { name: 'Continuar' }).tap()
      await page.getByLabel('Origem').fill('Porto de Itajaí')
      await page.getByLabel('Destino').fill('Base Navegantes')
      const levar = page.getByRole('checkbox', { name: 'Levar' })
      await levar.tap()
      await expect(levar).toBeChecked()
      await esperarDestacado(page.locator('label').filter({ has: levar }))
      await page.getByRole('button', { name: 'Continuar' }).tap()
      const ambos = page.getByRole('radio', { name: 'Ambos' })
      await ambos.tap()
      await expect(ambos).toHaveAttribute('aria-checked', 'true')
      await esperarDestacado(ambos)
    })
  })
}
