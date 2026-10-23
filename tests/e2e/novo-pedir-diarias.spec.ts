// v2.1 (Tarefa 6): o cliente pede com "Diárias (hospedagem)" e "Outros custos (opcional)", sem "Ida e volta"; o Para
// igual ao De conta como volta à origem (sem o retorno de trecho único). Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import { detalheFalso, ID_PEDIDO, orcamentoCliente, SEM_ACOES, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE } from './apoio/sessaoFalsa.ts'

const TELA = { width: 390, height: 844 }

/**
 * Preço falso: Passageiros 13000 + retorno (não cobra diária); IVO Viagem 20000 + retorno + 40000 por diária (cobra
 * diária). A volta à origem tira o retorno (5000). `cobra_diaria` é o campo que `categorias_disponiveis` devolve na v2.1.
 */
function categoriasFalsas(p: { diarias?: number; volta_a_origem?: boolean }) {
  const retorno = p.volta_a_origem ? 0 : 5000
  return {
    ok: true,
    categorias: [
      {
        codigo: 'PASSAGEIROS',
        nome: 'IVO Passageiros',
        descricao_curta: 'até 4 pessoas',
        disponivel: true,
        total_cent: 13000 + retorno,
        linhas: [],
        carga: 'PESSOAS',
        reboque: 'NAO',
        veiculo_cliente: false,
        cobra_hora: false,
        cobra_parada: false,
        cobra_diaria: false,
      },
      {
        codigo: 'VIAGEM',
        nome: 'IVO Viagem',
        descricao_curta: 'viagem longa',
        disponivel: true,
        total_cent: 20000 + retorno + 40000 * (p.diarias ?? 0),
        linhas: [],
        carga: 'PESSOAS',
        reboque: 'NAO',
        veiculo_cliente: false,
        cobra_hora: false,
        cobra_parada: false,
        cobra_diaria: true,
      },
    ],
  }
}

async function abrir(page: Page, o: { detalhes?: unknown[]; caminho?: string; largura?: number } = {}) {
  await page.setViewportSize({ ...TELA, width: o.largura ?? TELA.width })
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  const chamadas = await simularPedidos(page, { detalhes: o.detalhes })
  await simularMapas(page, { rota: { km: 42, minutos: 55 }, polyline: '_p~iF~ps|U_ulLnnqC' })
  await simularBlocosDoMapa(page)
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/locais_da_empresa`, (route: Route) => {
    const t = String((route.request().postDataJSON() as { p_texto?: string })?.p_texto ?? '').toLowerCase()
    return json(route, {
      ok: true,
      locais:
        t === '' || 'estaleiro navegantes'.includes(t) ? [{ nome: 'Estaleiro Navegantes', lat: null, lng: null, place_id: 'ChIJdef' }] : [],
    })
  })
  const categorias: Array<Record<string, unknown>> = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/categorias_disponiveis`, (route: Route) => {
    const p = (route.request().postDataJSON() as { p: Record<string, unknown> }).p
    categorias.push(p)
    return json(route, categoriasFalsas(p as { diarias?: number; volta_a_origem?: boolean }))
  })
  await page.goto(o.caminho ?? '/')
  return { chamadas, categorias }
}

async function escolher(page: Page, nome: string, texto: string, opcao: RegExp) {
  const campo = page.getByRole('combobox', { name: nome, exact: true })
  await campo.fill(texto)
  await page.getByRole('option', { name: opcao }).first().click()
}

/** De Estaleiro Navegantes (local da empresa) para o Porto de Itajaí (Google). */
async function ateAsCategorias(page: Page) {
  await escolher(page, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
  await escolher(page, 'Para', 'Porto', /Porto de Itajaí/)
  await expect(page.getByRole('radiogroup', { name: 'Categorias' })).toBeVisible()
}

const abrirDetalhes = (page: Page) => page.getByText('Detalhes da corrida (pessoas, carga, contato)').click()

const semRolagemLateral = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

const criarPedido = async (chamadas: Array<{ rpc: string; corpo: Record<string, unknown> }>) => {
  await expect.poll(() => chamadas.filter((c) => c.rpc === 'criar_pedido').length).toBe(1)
  return chamadas.find((c) => c.rpc === 'criar_pedido')!.corpo.p as Record<string, unknown>
}

test.describe('pedir com diárias e outros custos', () => {
  test('não existe "Ida e volta"; o preço vai com trazer falso e sem km_volta', async ({ page }) => {
    const { categorias } = await abrir(page)
    await ateAsCategorias(page)
    await abrirDetalhes(page)
    await expect(page.getByRole('checkbox', { name: 'Ida e volta' })).toHaveCount(0)
    await expect(page.getByText('Ida e volta')).toHaveCount(0)
    expect(categorias.at(-1)).toEqual({ km: 42, levar: true, trazer: false })
    expect(categorias.some((c) => 'km_volta' in c || c.trazer === true)).toBe(false)
  })

  test('"Diárias (hospedagem)" só na categoria que cobra diária, de 0 a 30, muda a prévia e vai no pedido', async ({ page }) => {
    const { categorias, chamadas } = await abrir(page)
    await ateAsCategorias(page)
    await abrirDetalhes(page)
    const diarias = page.getByRole('group', { name: 'Diárias (hospedagem)' })
    // IVO Passageiros (marcada por padrão) não cobra diária.
    await expect(page.getByRole('radio', { name: /IVO Passageiros/ })).toBeChecked()
    await expect(diarias).toHaveCount(0)

    const viagem = page.getByRole('radio', { name: /IVO Viagem/ })
    await viagem.click()
    await expect(diarias).toBeVisible()
    await expect(diarias).toContainText('Viagem com pernoite')
    await expect(diarias.locator('output')).toHaveText('0')
    await expect(page.getByRole('button', { name: 'Diminuir diárias (hospedagem)' })).toBeDisabled()
    await expect(viagem).toContainText('~R$ 250')

    const mais = page.getByRole('button', { name: 'Aumentar diárias (hospedagem)' })
    await mais.click()
    await mais.click()
    await expect(diarias.locator('output')).toHaveText('2')
    await expect.poll(() => categorias.at(-1)).toEqual({ km: 42, levar: true, trazer: false, diarias: 2 })
    await expect(viagem).toContainText('~R$ 1.050')

    // Teto de 30.
    for (let i = 2; i < 30; i++) await mais.click()
    await expect(diarias.locator('output')).toHaveText('30')
    await expect(mais).toBeDisabled()
    for (let i = 30; i > 2; i--) await page.getByRole('button', { name: 'Diminuir diárias (hospedagem)' }).click()
    await expect(diarias.locator('output')).toHaveText('2')

    // Trocar para a categoria sem diária esconde o contador.
    await page.getByRole('radio', { name: /IVO Passageiros/ }).click()
    await expect(diarias).toHaveCount(0)
    await viagem.click()
    await expect(diarias.locator('output')).toHaveText('2')

    await page.getByRole('button', { name: /^Pedir IVO Viagem · / }).click()
    const p = await criarPedido(chamadas)
    expect(p).toMatchObject({ categoria: 'VIAGEM', diarias_estimadas: 2, trazer: false, volta_a_origem: false })
    expect(p.outros_custos).toBeUndefined()
  })

  test('categoria sem diária: nenhuma diária vai no pedido', async ({ page }) => {
    const { chamadas } = await abrir(page)
    await ateAsCategorias(page)
    await page.getByRole('button', { name: /^Pedir IVO Passageiros · / }).click()
    const p = await criarPedido(chamadas)
    expect(p.diarias_estimadas).toBeUndefined()
    expect(p).toMatchObject({ trazer: false, volta_a_origem: false })
  })

  test('"Outros custos (opcional)": até 120 caracteres, "+ outros custos no orçamento" e outros_custos aparado no pedido', async ({ page }) => {
    const { chamadas } = await abrir(page)
    await ateAsCategorias(page)
    await abrirDetalhes(page)
    const outros = page.getByRole('textbox', { name: 'Outros custos (opcional)' })
    await expect(outros).toHaveAttribute('maxlength', '120')
    await expect(page.getByText('Pedágio, balsa… O valor vem no orçamento')).toBeVisible()
    const marcada = page.getByRole('radio', { name: /IVO Passageiros/ })
    await expect(marcada).not.toContainText('+ outros custos no orçamento')
    await outros.fill('  Pedágio da BR-101, balsa  ')
    await expect(marcada).toContainText('+ outros custos no orçamento')
    // Só embaixo do preço da categoria marcada.
    await expect(page.getByRole('radio', { name: /IVO Viagem/ })).not.toContainText('+ outros custos no orçamento')
    await page.getByRole('button', { name: /^Pedir IVO Passageiros · / }).click()
    const p = await criarPedido(chamadas)
    expect(p.outros_custos).toBe('Pedágio da BR-101, balsa')
  })

  test('De = Para (mesmo place_id): volta à origem na prévia e no pedido, com a parada no meio', async ({ page }) => {
    const { categorias, chamadas } = await abrir(page)
    await page.getByRole('button', { name: '+ Adicionar parada' }).click()
    await escolher(page, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
    await escolher(page, 'Parada 1', 'Porto', /Porto de Itajaí/)
    await escolher(page, 'Para', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
    await expect(page.getByRole('radiogroup', { name: 'Categorias' })).toBeVisible()
    await expect.poll(() => categorias.at(-1)).toEqual({ km: 42, levar: true, trazer: false, paradas: 1, volta_a_origem: true })
    // Sem o retorno de trecho único.
    await expect(page.getByRole('radio', { name: /IVO Passageiros/ })).toContainText('~R$ 130')
    await page.getByRole('button', { name: /^Pedir IVO Passageiros · / }).click()
    const p = await criarPedido(chamadas)
    expect(p).toMatchObject({ volta_a_origem: true, trazer: false, origem_place_id: 'ChIJdef', destino_place_id: 'ChIJdef' })
  })

  test('"Pedir de novo" traz as diárias; o pedido antigo de ida e volta abre como trecho único, sem erro', async ({ page }) => {
    const concluida = {
      ok: true,
      pedido: detalheFalso({
        status: 'CONCLUIDA',
        categoria: 'VIAGEM',
        categoria_nome: 'IVO Viagem',
        motorista_nome: 'Ivo Barbosa',
        origem: 'Estaleiro Navegantes',
        destino: 'Porto de Itajaí',
        origem_place_id: 'ChIJdef',
        destino_place_id: 'ChIJpor',
        levar: true,
        trazer: true,
        trechos_km: 2,
        diarias_estimadas: 2,
        saiu_em: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        concluiu_em: new Date(Date.now() - 3_600_000).toISOString(),
        km_rodados: 84,
        avaliacao: 5,
        fotos_qtd: 0,
      }),
      historico: [],
      orcamento: orcamentoCliente({ status: 'APROVADO', total_cent: 105000 }),
      acoes: { ...SEM_ACOES },
    }
    const erros: string[] = []
    page.on('pageerror', (e) => erros.push(e.message))
    const { categorias } = await abrir(page, { detalhes: [concluida], caminho: `/corrida/${ID_PEDIDO}` })
    await page.getByRole('button', { name: 'Pedir de novo' }).click()
    await expect(page.getByRole('radio', { name: /IVO Viagem/ })).toBeChecked()
    await expect.poll(() => categorias.at(-1)).toEqual({ km: 42, levar: true, trazer: false, diarias: 2 })
    await abrirDetalhes(page)
    await expect(page.getByRole('group', { name: 'Diárias (hospedagem)' }).locator('output')).toHaveText('2')
    await expect(page.getByText('Ida e volta')).toHaveCount(0)
    expect(categorias.some((c) => c.trazer === true || 'km_volta' in c)).toBe(false)
    expect(erros).toEqual([])
  })

  for (const largura of [390, 375]) {
    test(`${largura} px com as diárias e os outros custos: nada rola de lado; sem violações do axe`, async ({ page }) => {
      await abrir(page, { largura })
      await ateAsCategorias(page)
      await page.getByRole('radio', { name: /IVO Viagem/ }).click()
      await abrirDetalhes(page)
      await page.getByRole('button', { name: 'Aumentar diárias (hospedagem)' }).click()
      await page
        .getByRole('textbox', { name: 'Outros custos (opcional)' })
        .fill('Pedágio da BR-101 ida e volta, balsa de Navegantes e estacionamento')
      await expect(page.getByRole('radio', { name: /IVO Viagem/ })).toContainText('+ outros custos no orçamento')
      expect(await semRolagemLateral(page)).toBe(true)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    })
  }
})

test.describe('confirmar pela tabela', () => {
  const orcada = (extra: Record<string, unknown>) => ({
    ok: true,
    pedido: detalheFalso({
      status: 'ORCADA',
      categoria: 'VIAGEM',
      categoria_nome: 'IVO Viagem',
      motorista_nome: 'Ivo Barbosa',
      origem: 'Estaleiro Navegantes',
      destino: 'Porto de Itajaí',
      origem_place_id: 'ChIJdef',
      destino_place_id: 'ChIJpor',
      carga: 'PESSOAS',
      centro_custo: null,
      ...extra,
    }),
    historico: [],
    orcamento: {
      id: '00000000-0000-4000-8000-0000000000b1',
      versao: 2,
      status: 'PENDENTE',
      modalidade: 'VEICULO_PROPRIO',
      valido_ate: new Date(Date.now() + 20 * 3_600_000).toISOString(),
      horario_sugerido: null,
      enviado_em: new Date().toISOString(),
      linhas: [],
      total_cent: 100000,
      hash: 'b'.repeat(64),
    },
    acoes: { ...SEM_ACOES, aprovar: true },
  })

  test('"Pela tabela" usa as diárias estimadas e a volta à origem do pedido', async ({ page }) => {
    const { categorias } = await abrir(page, {
      detalhes: [orcada({ diarias_estimadas: 2, volta_a_origem: true, outros_custos: 'balsa' })],
      caminho: `/corrida/${ID_PEDIDO}`,
    })
    await expect(page.getByRole('button', { name: /^Confirmar corrida/ })).toBeVisible()
    await expect.poll(() => categorias.at(-1)).toEqual({ km: 42, levar: true, trazer: false, diarias: 2, volta_a_origem: true })
  })

  test('pedido antigo de ida e volta: "Pela tabela" continua com trazer verdadeiro', async ({ page }) => {
    const { categorias } = await abrir(page, {
      detalhes: [orcada({ levar: true, trazer: true, trechos_km: 2 })],
      caminho: `/corrida/${ID_PEDIDO}`,
    })
    await expect(page.getByRole('button', { name: /^Confirmar corrida/ })).toBeVisible()
    await expect.poll(() => categorias.at(-1)).toEqual({ km: 42, levar: true, trazer: true })
  })
})
