// Calendário (Agenda e Novo pedido): cada marcador visível tem legenda e cada legenda tem marcador visível,
// e os marcadores diferem por FORMA e COR. Bug de produção: a legenda não batia com os marcadores.
import { expect, test, type Locator, type Page } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { diaSp, diasDoMes, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

/** Mês com os quatro tipos: seu pedido (+5), aguardando você (+6), ocupado (+7), dia sem horário (+8). */
async function mesComTodosOsMarcadores(page: Page, tipos: Array<'meu' | 'aguardando' | 'ocupado' | 'sem_horario'>) {
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/dias_do_mes`, (route) => {
    const corpo = route.request().postDataJSON() as { p_mes: string; p_duracao_min: number }
    const dias = diasDoMes(corpo.p_mes).map((d) => ({
      ...d,
      meus: tipos.includes('meu') && d.dia === diaSp(5) ? 1 : tipos.includes('aguardando') && d.dia === diaSp(6) ? 1 : 0,
      aguardando_voce: tipos.includes('aguardando') && d.dia === diaSp(6) ? 1 : 0,
      ocupado: tipos.includes('ocupado') && d.dia === diaSp(7),
      dia_cheio: tipos.includes('sem_horario') && d.dia === diaSp(8),
      livre: !(tipos.includes('sem_horario') && d.dia === diaSp(8)) && d.dia >= diaSp(0),
    }))
    return json(route, { ok: true, mes: corpo.p_mes, duracao_min: corpo.p_duracao_min, dias })
  })
}

const tiposDe = async (l: Locator, atributo: string) =>
  [...new Set(await l.evaluateAll((els, a) => els.map((e) => e.getAttribute(a)!), atributo))].sort()

/** Marcadores nas células do mês × itens da legenda: os mesmos conjuntos. */
async function conferirLegenda(page: Page) {
  const calendario = page.getByTestId('calendario')
  await expect(calendario.locator('[data-dia]').first()).toBeVisible()
  const marcadores = await tiposDe(calendario.locator('[data-dia] [data-marcador]'), 'data-marcador')
  const legenda = page.getByTestId('legenda-calendario')
  const itens = marcadores.length ? await tiposDe(legenda.locator('[data-legenda]'), 'data-legenda') : []
  expect(itens).toEqual(marcadores)
  return { marcadores, legenda }
}

/** Forma e cor de cada marcador de ponto/triângulo (iguais na célula e na legenda). */
async function formaECor(l: Locator) {
  return l.evaluate((svg) => {
    const f = svg.firstElementChild as SVGElement
    return { forma: f.tagName, cor: getComputedStyle(f).fill }
  })
}

/** Volta ao mês atual (se preciso) e avança até o mês do dia; devolve a célula. */
async function irAoDia(page: Page, dia: string) {
  const calendario = page.getByTestId('calendario')
  const anterior = calendario.getByRole('button', { name: 'Mês anterior' })
  while (await anterior.isEnabled()) await anterior.click()
  const celula = calendario.locator(`[data-dia="${dia}"]`)
  if ((await celula.count()) === 0) await calendario.getByRole('button', { name: 'Próximo mês' }).click()
  await expect(celula).toBeVisible()
  return celula
}

const CLIENTE_N1: PerfilFalso = { papel: 'CLIENTE', nivel: 1, nome: 'Carla Dias', empresa_nome: 'Umi San' }

test.describe('legenda = marcadores', () => {
  test('novo pedido: os quatro tipos, cada um com legenda; forma e cor diferentes', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N1)
    await simularApi(page)
    await simularPedidos(page)
    await mesComTodosOsMarcadores(page, ['meu', 'aguardando', 'ocupado', 'sem_horario'])
    await page.goto('/pedidos/novo')
    // Os dias +5…+8 podem cair no mês seguinte: confere os dois meses.
    const vistos = new Set<string>()
    for (let i = 0; i < 2; i++) {
      const { marcadores, legenda } = await conferirLegenda(page)
      marcadores.forEach((m) => vistos.add(m))
      for (const tipo of marcadores.filter((m) => m !== 'sem_horario')) {
        const naCelula = await formaECor(page.getByTestId('calendario').locator(`[data-dia] [data-marcador="${tipo}"]`).first())
        const naLegenda = await formaECor(legenda.locator(`[data-legenda="${tipo}"] [data-marcador="${tipo}"]`))
        expect(naLegenda, tipo).toEqual(naCelula)
      }
      if (i === 0) await page.getByTestId('calendario').getByRole('button', { name: 'Próximo mês' }).click()
    }
    expect([...vistos].sort()).toEqual(['aguardando', 'meu', 'ocupado', 'sem_horario'])

    // Forma E cor: seu pedido = círculo #1E4B7A; aguardando = triângulo #C2410C; ocupado = círculo cinza.
    const esperado = {
      meu: { dia: diaSp(5), forma: 'circle', cor: 'rgb(30, 75, 122)' },
      aguardando: { dia: diaSp(6), forma: 'path', cor: 'rgb(194, 65, 12)' },
      ocupado: { dia: diaSp(7), forma: 'circle', cor: 'rgb(116, 133, 156)' }, // #74859C: 3,4:1 sobre o papel (o #96A6BB antigo dava 2,3:1)
    }
    for (const [tipo, e] of Object.entries(esperado)) {
      const celula = await irAoDia(page, e.dia)
      expect(await formaECor(celula.locator(`[data-marcador="${tipo}"]`)), tipo).toEqual({ forma: e.forma, cor: e.cor })
    }
    // Dia sem horário: número riscado na célula e na legenda.
    const cheio = await irAoDia(page, diaSp(8))
    await expect(cheio.locator('[data-marcador="sem_horario"]')).toHaveCSS('text-decoration-line', 'line-through')
    await expect(page.getByTestId('legenda-calendario').locator('[data-legenda="sem_horario"] span').first()).toHaveCSS(
      'text-decoration-line',
      'line-through',
    )
  })

  test('mês sem nenhum marcador: sem legenda', async ({ page }) => {
    await comSessaoFalsa(page, CLIENTE_N1)
    await simularApi(page)
    await simularPedidos(page)
    await mesComTodosOsMarcadores(page, [])
    await page.goto('/pedidos/novo')
    const { marcadores } = await conferirLegenda(page)
    expect(marcadores).toEqual([])
    await expect(page.getByTestId('legenda-calendario')).toHaveCount(0)
  })

  for (const caso of [
    { nome: 'cliente N1', perfil: CLIENTE_N1, aal2: false },
    { nome: 'motorista', perfil: { papel: 'MOTORISTA', tem_2fa: true } as PerfilFalso, aal2: true },
  ]) {
    test(`agenda (${caso.nome}): só um tipo no mês → só ele na legenda`, async ({ page }) => {
      await comSessaoFalsa(page, caso.perfil, caso.aal2 ? { aal: 'aal2' } : {})
      await simularApi(page)
      await simularPedidos(page)
      await mesComTodosOsMarcadores(page, ['aguardando'])
      await page.goto('/agenda')
      const { marcadores } = await conferirLegenda(page)
      // aguardando também é "meu" (o pedido é visível ao perfil) — ou nada, se +6 cair no mês seguinte.
      if (marcadores.length) expect(marcadores).toEqual(['aguardando', 'meu'])
    })
  }
})
