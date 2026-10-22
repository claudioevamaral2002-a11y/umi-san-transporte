// Fase 4.1 (Tarefa 6): o cliente pede com paradas, horas estimadas e centro de custo (mockups 1 e 2 de
// docs/redesign/mockups-fase-4-1.html). Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { LOCAL_EMPRESA, simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import { detalheFalso, ID_PEDIDO, SEM_ACOES, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE } from './apoio/sessaoFalsa.ts'

const TELA = { width: 390, height: 844 }
const CHAVE_CC = 'ivo:ultimo-centro-custo'

/** Preço falso: Passageiros 18000 + 1500 por parada; IVO Motorista 9000 por hora (sem horas = preço pendente). */
function categoriasFalsas(p: { paradas?: number; horas?: number }) {
  const paradas = p.paradas ?? 0
  return {
    ok: true,
    categorias: [
      {
        codigo: 'PASSAGEIROS',
        nome: 'IVO Passageiros',
        descricao_curta: 'até 4 pessoas',
        disponivel: true,
        total_cent: 18000 + 1500 * paradas,
        linhas: [],
        carga: 'PESSOAS',
        reboque: 'NAO',
        veiculo_cliente: false,
        cobra_hora: false,
        cobra_parada: true,
      },
      {
        codigo: 'MOTORISTA',
        nome: 'IVO Motorista',
        descricao_curta: 'Ivo dirige o carro da sua empresa',
        disponivel: true,
        total_cent: p.horas ? 9000 * p.horas : null,
        linhas: null,
        carga: 'PESSOAS',
        reboque: 'NAO',
        veiculo_cliente: true,
        cobra_hora: true,
        cobra_parada: false,
      },
      {
        codigo: 'VAN',
        nome: 'IVO Van',
        descricao_curta: 'até 12 pessoas',
        disponivel: false,
        total_cent: null,
        linhas: null,
        carga: 'PESSOAS',
        reboque: 'NAO',
        veiculo_cliente: false,
        cobra_hora: false,
        cobra_parada: false,
      },
    ],
  }
}

async function abrir(page: Page, o: { centro?: string; detalhes?: unknown[]; caminho?: string } = {}) {
  await page.setViewportSize(TELA)
  if (o.centro !== undefined) await page.addInitScript(([k, v]) => localStorage.setItem(k!, v!), [CHAVE_CC, o.centro])
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  const chamadas = await simularPedidos(page, { detalhes: o.detalhes })
  const mapas = await simularMapas(page, { rota: { km: 42, minutos: 55 }, polyline: '_p~iF~ps|U_ulLnnqC' })
  await simularBlocosDoMapa(page)
  // A volta direta (Porto → Estaleiro Navegantes, sem paradas) tem outro km; o resto fica com `simularMapas`.
  await page.route(`${URL_SUPABASE}/functions/v1/enderecos`, (route: Route) => {
    const c = route.request().postDataJSON() as { acao: string; destino?: { place_id?: string } }
    if (c.acao === 'rota' && c.destino?.place_id === 'ChIJdef') {
      mapas.push(c)
      return json(route, { ok: true, km: 38.64, minutos: 50 })
    }
    return route.fallback()
  })
  // Locais da empresa: contados para provar que nada preenche a origem ao abrir.
  const locais: unknown[] = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/locais_da_empresa`, (route: Route) => {
    locais.push(route.request().postDataJSON())
    const t = String((route.request().postDataJSON() as { p_texto?: string })?.p_texto ?? '').toLowerCase()
    return json(route, { ok: true, locais: t === '' || 'estaleiro navegantes'.includes(t) ? [LOCAL_EMPRESA] : [] })
  })
  const categorias: Array<Record<string, unknown>> = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/categorias_disponiveis`, (route: Route) => {
    const p = (route.request().postDataJSON() as { p: Record<string, unknown> }).p
    categorias.push(p)
    return json(route, categoriasFalsas(p as { paradas?: number; horas?: number }))
  })
  const confirmar: Array<Record<string, unknown>> = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/confirmar_corrida`, (route: Route) => {
    confirmar.push(route.request().postDataJSON() as Record<string, unknown>)
    return json(route, { ok: true, atividade_id: ID_PEDIDO, reservado_cent: 22000, disponivel_cent: 227000 })
  })
  await page.goto(o.caminho ?? '/')
  return { chamadas, mapas, locais, categorias, confirmar }
}

/** Escolhe a opção `opcao` no campo de endereço `nome` (digitando `texto`). */
async function escolher(page: Page, nome: string, texto: string, opcao: RegExp) {
  const campo = page.getByRole('combobox', { name: nome, exact: true })
  await campo.fill(texto)
  await page.getByRole('option', { name: opcao }).first().click()
  return campo
}

const semRolagemLateral = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

const criarPedido = async (chamadas: Array<{ rpc: string; corpo: Record<string, unknown> }>) => {
  await expect.poll(() => chamadas.filter((c) => c.rpc === 'criar_pedido').length).toBe(1)
  return chamadas.find((c) => c.rpc === 'criar_pedido')!.corpo.p as Record<string, unknown>
}

test.describe('pedir com paradas', () => {
  test('a origem começa vazia: nenhuma chamada preenche o "De"', async ({ page }) => {
    const { locais, mapas } = await abrir(page)
    await expect(page.getByTestId('folha-mapa')).toContainText('Diego')
    const de = page.getByRole('combobox', { name: 'De', exact: true })
    const para = page.getByRole('combobox', { name: 'Para', exact: true })
    await expect(de).toBeVisible()
    await expect(para).toBeVisible()
    await page.waitForTimeout(800)
    await expect(de).toHaveValue('')
    expect(locais).toEqual([])
    expect(mapas).toEqual([])
    // De em cima, Para embaixo.
    const yDe = (await de.boundingBox())!.y
    const yPara = (await para.boundingBox())!.y
    expect(yDe).toBeLessThan(yPara)
  })

  test('"+ Adicionar parada" até 3 (o botão some), × remove, e a rota e o preço levam as paradas', async ({ page }) => {
    const { mapas, categorias, chamadas } = await abrir(page)
    const adicionar = page.getByRole('button', { name: '+ Adicionar parada' })
    await adicionar.click()
    await adicionar.click()
    await adicionar.click()
    await expect(page.getByRole('combobox', { name: /^Parada \d$/ })).toHaveCount(3)
    await expect(adicionar).toHaveCount(0)
    await page.getByRole('button', { name: 'Remover parada 3' }).click()
    await page.getByRole('button', { name: 'Remover parada 2' }).click()
    await expect(page.getByRole('combobox', { name: /^Parada \d$/ })).toHaveCount(1)
    await expect(adicionar).toBeVisible()

    await escolher(page, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
    await escolher(page, 'Parada 1', 'Detroit', /Estaleiro Detroit/)
    await escolher(page, 'Para', 'Porto', /Porto de Itajaí/)
    await expect(page.getByRole('radiogroup', { name: 'Categorias' })).toBeVisible()

    // O mapa recebe a rota inteira: origem → parada → destino, numa chamada só.
    const rota = mapas.filter((c) => c.acao === 'rota').at(-1)!
    expect(rota.paradas).toEqual([{ place_id: 'ChIJdet' }])
    expect(rota.destino).toEqual({ place_id: 'ChIJpor' })
    // O preço é pedido com a quantidade de paradas.
    expect(categorias.at(-1)).toEqual({ km: 42, levar: true, trazer: false, paradas: 1 })
    await expect(page.getByRole('radio', { name: /IVO Passageiros/ })).toContainText('~R$ 195')
    await expect(page.getByRole('radio', { name: /IVO Van/ })).toContainText('Indisponível no momento')

    // De → Parada → Para no topo da escolha de categoria.
    const percurso = page.getByTestId('rota-de-para')
    await expect(percurso).toContainText('De')
    await expect(percurso).toContainText('Parada')
    await expect(percurso).toContainText('Estaleiro Detroit')
    await expect(percurso).toContainText('Para')

    await page.getByRole('button', { name: /^Pedir IVO Passageiros · / }).click()
    const p = await criarPedido(chamadas)
    expect(p).toMatchObject({ categoria: 'PASSAGEIROS', modalidade: 'VEICULO_PROPRIO', paradas: [{ texto: 'Estaleiro Detroit', place_id: 'ChIJdet' }] })
    expect(p.horas_estimadas).toBeUndefined()
  })

  test('ida e volta: a ida passa pelas paradas e a volta direta vai em km_volta', async ({ page }) => {
    const { mapas, categorias } = await abrir(page)
    await page.getByRole('button', { name: '+ Adicionar parada' }).click()
    await escolher(page, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
    await escolher(page, 'Parada 1', 'Detroit', /Estaleiro Detroit/)
    await escolher(page, 'Para', 'Porto', /Porto de Itajaí/)
    await expect(page.getByRole('radiogroup', { name: 'Categorias' })).toBeVisible()
    await page.getByText('Detalhes da corrida (pessoas, carga, contato)').click()
    await page.getByRole('checkbox', { name: 'Ida e volta' }).check()
    await expect.poll(() => categorias.at(-1)).toEqual({ km: 42, km_volta: 38.6, levar: true, trazer: true, paradas: 1 })
    const volta = mapas.filter((c) => c.acao === 'rota').at(-1)!
    expect(volta).toMatchObject({ origem: { place_id: 'ChIJpor' }, destino: { place_id: 'ChIJdef' } })
    expect(volta.paradas).toBeUndefined()
  })

  test('da escolha de categoria, "+ Adicionar parada" volta aos endereços com uma parada nova', async ({ page }) => {
    await abrir(page)
    await escolher(page, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
    await escolher(page, 'Para', 'Porto', /Porto de Itajaí/)
    await expect(page.getByRole('radiogroup', { name: 'Categorias' })).toBeVisible()
    await page.getByRole('button', { name: '+ Adicionar parada' }).click()
    const parada = page.getByRole('combobox', { name: 'Parada 1', exact: true })
    await expect(parada).toBeFocused()
    await expect(page.getByRole('combobox', { name: 'De', exact: true })).toHaveValue('Estaleiro Navegantes')
    await expect(page.getByRole('combobox', { name: 'Para', exact: true })).toHaveValue('Porto de Itajaí')
    await escolher(page, 'Parada 1', 'Detroit', /Estaleiro Detroit/)
    await expect(page.getByRole('radiogroup', { name: 'Categorias' })).toBeVisible()
    await expect(page.getByTestId('rota-de-para')).toContainText('Estaleiro Detroit')
  })

  test('IVO Motorista: "Horas estimadas" com − / +, preço pedido com as horas e enviado em criar_pedido', async ({ page }) => {
    const { categorias, chamadas } = await abrir(page)
    await escolher(page, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
    await escolher(page, 'Para', 'Porto', /Porto de Itajaí/)
    const motorista = page.getByRole('radio', { name: /IVO Motorista/ })
    // Sem horas o preço fica pendente, mas a categoria pode ser escolhida.
    await expect(motorista).toBeEnabled()
    await expect(motorista).not.toContainText('R$')
    await expect(page.getByRole('group', { name: 'Horas estimadas' })).toHaveCount(0)
    await motorista.click()
    const horas = page.getByRole('group', { name: 'Horas estimadas' })
    await expect(horas).toBeVisible()
    await expect(page.getByRole('button', { name: /^Pedir IVO Motorista/ })).toHaveCount(0)
    await page.getByRole('button', { name: 'Aumentar horas estimadas' }).click()
    await expect.poll(() => categorias.at(-1)?.horas).toBe(1)
    await expect(motorista).toContainText('~R$ 90')
    await page.getByRole('button', { name: 'Aumentar horas estimadas' }).click()
    await expect.poll(() => categorias.at(-1)?.horas).toBe(1.5)
    await expect(horas).toContainText('1,5 h')
    await page.getByRole('button', { name: 'Diminuir horas estimadas' }).click()
    await page.getByRole('button', { name: 'Aumentar horas estimadas' }).click()
    await expect(motorista).toContainText('~R$ 135')
    await page.getByRole('button', { name: /^Pedir IVO Motorista · / }).click()
    const p = await criarPedido(chamadas)
    expect(p).toMatchObject({ categoria: 'MOTORISTA', modalidade: 'VEICULO_CLIENTE', horas_estimadas: 1.5 })
  })

  test('"Centro de custo (opcional)" acima do botão, com o último usado; vai em criar_pedido e fica guardado', async ({ page }) => {
    const { chamadas } = await abrir(page, { centro: 'Operações 4.100' })
    await escolher(page, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
    await escolher(page, 'Para', 'Porto', /Porto de Itajaí/)
    const centro = page.getByRole('textbox', { name: 'Centro de custo (opcional)' })
    await expect(centro).toHaveValue('Operações 4.100')
    await expect(centro).toHaveAttribute('maxlength', '80')
    const pedir = page.getByRole('button', { name: /^Pedir IVO Passageiros · / })
    expect((await centro.boundingBox())!.y).toBeLessThan((await pedir.boundingBox())!.y)
    await centro.fill('  Diretoria  ')
    await pedir.click()
    const p = await criarPedido(chamadas)
    expect(p.centro_custo).toBe('Diretoria')
    await expect(page).toHaveURL(/\/corrida\//)
    expect(await page.evaluate((k) => localStorage.getItem(k), CHAVE_CC)).toBe('Diretoria')
  })

  test('a confirmação mostra o centro de custo do pedido, editável, e confere a tabela com as paradas', async ({ page }) => {
    const orcada = {
      ok: true,
      pedido: detalheFalso({
        status: 'ORCADA',
        categoria: 'PASSAGEIROS',
        categoria_nome: 'IVO Passageiros',
        motorista_nome: 'Ivo Barbosa',
        origem: 'Estaleiro Navegantes',
        destino: 'Porto de Itajaí',
        origem_place_id: 'ChIJdef',
        destino_place_id: 'ChIJpor',
        carga: 'PESSOAS',
        centro_custo: 'Obra Norte',
        paradas: [{ texto: 'Estaleiro Detroit', place_id: 'ChIJdet', lat: null, lng: null }],
        agora: false,
      }),
      historico: [],
      orcamento: {
        id: '00000000-0000-4000-8000-0000000000b1',
        versao: 2,
        status: 'PENDENTE',
        modalidade: 'VEICULO_PROPRIO',
        valido_ate: new Date(Date.now() + 20 * 60 * 60_000).toISOString(),
        horario_sugerido: null,
        enviado_em: new Date().toISOString(),
        linhas: [],
        total_cent: 19500,
        hash: 'b'.repeat(64),
      },
      acoes: { ...SEM_ACOES, aprovar: true, pedir_revisao: true, reprovar: true, cancelar: true },
    }
    const { confirmar, mapas, categorias } = await abrir(page, { centro: 'Outro', detalhes: [orcada], caminho: `/corrida/${ID_PEDIDO}` })
    const centro = page.getByRole('textbox', { name: 'Centro de custo (opcional)' })
    await expect(centro).toHaveValue('Obra Norte')
    await expect.poll(() => mapas.filter((c) => c.acao === 'rota').at(-1)?.paradas).toEqual([{ place_id: 'ChIJdet' }])
    await expect.poll(() => categorias.at(-1)).toEqual({ km: 42, levar: true, trazer: false, paradas: 1 })
    await centro.fill('Obra Sul')
    await page.getByRole('button', { name: /^Confirmar corrida/ }).click()
    await expect.poll(() => confirmar.length).toBe(1)
    expect(confirmar[0]).toMatchObject({ p_centro_custo: 'Obra Sul' })
  })

  test('390 px com 3 paradas e a agenda aberta: nada rola de lado; sem violações do axe', async ({ page }) => {
    await abrir(page)
    const adicionar = page.getByRole('button', { name: '+ Adicionar parada' })
    for (let i = 0; i < 3; i++) await adicionar.click()
    await expect(adicionar).toHaveCount(0)
    expect(await semRolagemLateral(page)).toBe(true)
    await escolher(page, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
    await escolher(page, 'Parada 1', 'Detroit', /Estaleiro Detroit/)
    await escolher(page, 'Parada 2', 'Navship', /Estaleiro Navship/)
    await escolher(page, 'Parada 3', 'Porto', /Porto de Itajaí/)
    expect(await semRolagemLateral(page)).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    await escolher(page, 'Para', 'Detroit', /Estaleiro Detroit/)
    await expect(page.getByRole('radiogroup', { name: 'Categorias' })).toBeVisible()
    await expect(page.getByTestId('rota-de-para').getByText('Parada', { exact: true })).toHaveCount(3)
    await page.getByRole('button', { name: /^Agendar · / }).click()
    await expect(page.getByRole('radiogroup', { name: 'Dia' })).toBeVisible()
    expect(await semRolagemLateral(page)).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })
})
