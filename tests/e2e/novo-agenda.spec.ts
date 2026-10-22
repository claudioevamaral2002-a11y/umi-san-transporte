// Fase 4.1 (Tarefa 10): agenda ajustada (faixa de dias + horários por período) com rolagem lateral própria.
// Roda no projeto Playwright `novo` (dist-novo).
import { expect, test, type Page, type Route } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import { instanteSp, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE } from './apoio/sessaoFalsa.ts'

const TELA = { width: 390, height: 844 }

/** Horários livres de qualquer dia: 08:00 a 20:00, de hora em hora (manhã, tarde e noite). */
async function abrirAgenda(page: Page) {
  await page.setViewportSize(TELA)
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  await simularPedidos(page, {})
  await simularMapas(page, { rota: { km: 42, minutos: 55 }, polyline: '_p~iF~ps|U_ulLnnqC' })
  await simularBlocosDoMapa(page)
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/horarios_livres`, (route: Route) => {
    const c = route.request().postDataJSON() as { p_dia: string; p_duracao_min: number }
    const horarios = Array.from({ length: 13 }, (_, i) => instanteSp(c.p_dia, `${String(8 + i).padStart(2, '0')}:00`))
    return json(route, { ok: true, dia: c.p_dia, duracao_min: c.p_duracao_min, horarios, dia_cheio: false })
  })
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/categorias_disponiveis`, (route: Route) =>
    json(route, {
      ok: true,
      categorias: [{ codigo: 'PASSAGEIROS', nome: 'IVO Passageiros', descricao_curta: 'até 4 pessoas', disponivel: true, total_cent: 18000, linhas: [] }],
    }),
  )
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Origem' })).toHaveValue('Estaleiro Navegantes')
  const destino = page.getByRole('combobox', { name: 'Destino' })
  await destino.fill('Porto')
  await page.getByRole('option', { name: /Porto de Itajaí/ }).click()
  await expect(page.getByRole('radiogroup', { name: 'Categorias' })).toBeVisible()
  await page.getByRole('button', { name: /^Agendar · / }).click()
  await expect(page.getByRole('radiogroup', { name: 'Dia' })).toBeVisible()
}

test.describe('agenda ajustada', () => {
  test('faixa de dias com rolagem-ivo, scroll-snap e barra fina; sem rolagem lateral da página', async ({ page }) => {
    await abrirAgenda(page)
    const faixa = page.getByRole('radiogroup', { name: 'Dia' })
    await expect(faixa).toHaveClass(/rolagem-ivo/)
    const estilo = await faixa.evaluate((el) => {
      const c = getComputedStyle(el)
      return { snap: c.scrollSnapType, barra: c.scrollbarWidth, x: c.overflowX }
    })
    expect(estilo.snap).toContain('x mandatory')
    expect(estilo.barra).toBe('thin')
    expect(estilo.x).toBe('auto')
    await expect(faixa.getByRole('radio')).toHaveCount(14)
    const estourou = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(estourou).toBe(false)
  })

  test('horários agrupados em Manhã, Tarde e Noite, em 4 colunas', async ({ page }) => {
    await abrirAgenda(page)
    for (const nome of ['Manhã', 'Tarde', 'Noite']) await expect(page.locator(`[data-periodo="${nome}"]`)).toBeVisible()
    await expect(page.locator('[data-periodo="Manhã"]').getByRole('radio')).toHaveText(['08:00', '09:00', '10:00', '11:00'])
    await expect(page.locator('[data-periodo="Noite"]').getByRole('radio')).toHaveText(['18:00', '19:00', '20:00'])
    const colunas = await page
      .locator('[data-periodo="Tarde"] > div')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    expect(colunas).toBe(4)
  })

  test('escolher um horário e usar as setas do teclado nos dias', async ({ page }) => {
    await abrirAgenda(page)
    await page.getByRole('radio', { name: '09:00' }).click()
    await expect(page.getByRole('radio', { name: '09:00' })).toHaveAttribute('aria-checked', 'true')
    const faixa = page.getByRole('radiogroup', { name: 'Dia' })
    const marcado = faixa.locator('[aria-checked="true"]')
    const antes = (await marcado.textContent()) ?? ''
    await marcado.focus()
    await page.keyboard.press('ArrowRight')
    await expect(marcado).not.toHaveText(antes)
  })

  test('a folha não passa da altura da tela a 390 × 844 e a página não rola de lado', async ({ page }) => {
    await abrirAgenda(page)
    await expect(page.locator('[data-periodo="Noite"]')).toBeVisible()
    const r = await page.evaluate(() => {
      const lista = document.querySelector('[data-periodo="Noite"]')!.closest('[role="radiogroup"]')!
      const b = lista.getBoundingClientRect()
      return {
        altura: b.height,
        janela: window.innerHeight,
        estourou: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }
    })
    expect(r.altura).toBeLessThanOrEqual(r.janela * 0.4)
    expect(r.estourou).toBe(false)
  })

  test('movimento reduzido: a rolagem não anima; sem redução, anima', async ({ page }) => {
    await abrirAgenda(page)
    const faixa = page.getByRole('radiogroup', { name: 'Dia' })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    expect(await faixa.evaluate((el) => getComputedStyle(el).scrollBehavior)).toBe('smooth')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await faixa.evaluate((el) => getComputedStyle(el).scrollBehavior)).toBe('auto')
  })

  test('no celular as setas ‹ › ficam escondidas (a rolagem é com o dedo)', async ({ page }) => {
    await abrirAgenda(page)
    await expect(page.getByRole('button', { name: 'Próximos dias' })).toBeHidden()
  })
})

test.describe('agenda no computador', () => {
  test.use({ hasTouch: false, isMobile: false })
  test('as setas ‹ › avançam um bloco', async ({ page }) => {
    await abrirAgenda(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const faixa = page.getByRole('radiogroup', { name: 'Dia' })
    await page.getByRole('button', { name: 'Próximos dias' }).click()
    await expect.poll(() => faixa.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100)
    await page.getByRole('button', { name: 'Dias anteriores' }).click()
    await expect.poll(() => faixa.evaluate((el) => el.scrollLeft)).toBeLessThan(5)
  })
})
