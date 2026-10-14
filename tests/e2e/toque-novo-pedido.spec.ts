// Novo pedido no celular, por TOQUE (hasTouch + tap), em Pixel e iPhone, nos temas claro e escuro.
// Bug de produção: o toque mudava a seleção, mas no tema escuro o dia/horário escolhido ficava com a mesma cor
// da superfície (marinho sobre marinho) — parecia que nada tinha sido selecionado.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { DIA_PEDIDO, diaSp, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

/** Luminância relativa (WCAG) de "rgb(r, g, b)" / "rgba(r, g, b, a)" (alfa ignorado: os fundos aqui são opacos). */
function luminancia(cor: string): number {
  const [r, g, b] = (cor.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
    const c = Number(v) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m) as [number, number]
  return (x + 0.05) / (y + 0.05)
}
const fundo = (l: Locator) => l.evaluate((e) => getComputedStyle(e).backgroundColor)
/** Fundo efetivo atrás do elemento (primeiro ancestral com fundo não transparente). */
const fundoAtras = (l: Locator) =>
  l.evaluate((e) => {
    for (let p = e.parentElement; p; p = p.parentElement) {
      const c = getComputedStyle(p).backgroundColor
      if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c
    }
    return getComputedStyle(document.body).backgroundColor
  })

/** O item escolhido precisa se destacar do que está atrás dele (≥ 3:1, WCAG 1.4.11). */
async function esperarDestacado(item: Locator) {
  await expect.poll(async () => contraste(await fundo(item), await fundoAtras(item))).toBeGreaterThanOrEqual(3)
}

async function abrir(page: Page) {
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  const chamadas = await simularPedidos(page)
  await page.goto('/pedidos/novo')
  await expect(page.getByTestId('calendario').locator('[data-dia]').first()).toBeVisible()
  return chamadas
}

async function tocarDia(page: Page, dia: string) {
  const calendario = page.getByTestId('calendario')
  const botao = calendario.locator(`[data-dia="${dia}"]`)
  if ((await botao.count()) === 0) await calendario.getByRole('button', { name: 'Próximo mês' }).tap()
  await botao.tap()
  return botao
}

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
      await expect(page.getByTestId('calendario').locator(`[data-dia="${DIA_PEDIDO}"]`)).toHaveAttribute('aria-pressed', 'false')
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
