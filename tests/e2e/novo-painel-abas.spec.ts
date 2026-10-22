// Fase 4.1 (Tarefa 9, mockup "painel com abas"): o painel da empresa é um só, com abas de verdade (Painel · Corridas ·
// Pessoas · Carteira) em /empresa, /empresa/corridas, /empresa/pessoas e /empresa/carteira. O cabeçalho, o "← Início" e
// o seletor de empresa do Master ficam em todas. Roda no projeto Playwright `novo` (dist-novo).
import { readFile } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { EMPRESA_PORTO, EMPRESA_UMI, simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { diaSp, ID_PEDIDO, instanteSp, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const N1: PerfilFalso = { papel: 'CLIENTE', nivel: 1, nome: 'Marina Souza', empresa_nome: 'Umi San' }
const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }
const COMPUTADOR = { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }

function corrida(extra: Record<string, unknown>) {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    numero: 41,
    solicitante_nome: 'Marina Souza',
    inicio: instanteSp(diaSp(2), '08:30'),
    fim_previsto: instanteSp(diaSp(2), '09:25'),
    origem: 'Umi San · Rua Araguaia, 49',
    destino: 'Porto de Itajaí · Portão 3',
    paradas: ['Posto Shell · BR-101', 'Cliente Norte · Av. Brasil, 10'],
    horas_estimadas: 2.5,
    categoria_nome: 'IVO Passageiros',
    centro_custo: 'Operações 4.100',
    status: 'AGENDADA',
    valor_cent: 22000,
    estimado: false,
    ...extra,
  }
}

const DO_MES = [
  corrida({ inicio: '2026-10-02T11:30:00Z', centro_custo: 'Obra; Galpão 2', status: 'CONCLUIDA' }),
  corrida({
    id: '00000000-0000-4000-8000-0000000000b2',
    numero: 42,
    inicio: '2026-10-05T11:30:00Z',
    paradas: [],
    horas_estimadas: null,
    status: 'CANCELADA',
    valor_cent: 3300,
  }),
  corrida({
    id: '00000000-0000-4000-8000-0000000000b3',
    numero: 43,
    solicitante_nome: 'Paulo Lima',
    inicio: '2026-10-09T11:30:00Z',
    paradas: [],
    centro_custo: 'Diretoria',
    status: 'CONCLUIDA',
    valor_cent: 16500,
  }),
]

const DO_MES_ANTERIOR = [
  corrida({
    id: '00000000-0000-4000-8000-0000000000b9',
    numero: 30,
    solicitante_nome: 'Carla Dias',
    inicio: '2026-09-12T11:30:00Z',
    paradas: [],
    status: 'CONCLUIDA',
    valor_cent: 9900,
  }),
]

function painel(doMes: unknown[]) {
  return {
    ok: true,
    resumo: {
      mes: '2026-10-01',
      gasto_cent: 438000,
      reservado_cent: 62000,
      disponivel_cent: 782000,
      total_mes_cent: 1152600,
      contato_recarga: '(47) 99999-0000',
    },
    proximas: [corrida({})],
    recentes: [corrida({ id: ID_PEDIDO, numero: 40, status: 'CONCLUIDA', inicio: instanteSp(diaSp(-1), '10:00') })],
    do_mes: doMes,
    pessoas: { sem_corridas: 3, convites_pendentes: 1 },
  }
}

async function abrir(page: Page, perfil: PerfilFalso, caminho = '/empresa') {
  await comSessaoFalsa(page, perfil, perfil.papel === 'CLIENTE' ? {} : { aal: 'aal2' })
  await simularMapas(page)
  await page.route('https://tile.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await simularApi(page, { empresas: [EMPRESA_UMI, EMPRESA_PORTO] })
  await simularPedidos(page, {})
  const chamadas: Array<Record<string, unknown>> = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/painel_empresa`, (r) => {
    const corpo = r.request().postDataJSON() as Record<string, unknown>
    chamadas.push(corpo)
    return json(r, painel(corpo.p_mes ? DO_MES_ANTERIOR : DO_MES))
  })
  await page.goto(caminho)
  return chamadas
}

const abas = (page: Page) => page.getByRole('navigation', { name: 'Painel da empresa' })

test.describe('no computador', () => {
  test.use(COMPUTADOR)

  test('as quatro abas são rotas: trocam o conteúdo e mantêm o cabeçalho e o "← Início"', async ({ page }) => {
    await abrir(page, N1)
    const inicio = page.getByRole('navigation', { name: 'Página' }).getByRole('link', { name: /Início/ })
    await expect(inicio).toBeVisible()
    await expect(abas(page).getByRole('link', { name: 'Painel' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { name: 'Resumo de outubro' })).toBeVisible()

    await abas(page).getByRole('link', { name: 'Corridas' }).click()
    await expect(page).toHaveURL(/\/empresa\/corridas$/)
    await expect(abas(page).getByRole('link', { name: 'Corridas' })).toHaveAttribute('aria-current', 'page')
    await expect(abas(page).getByRole('link', { name: 'Painel' })).not.toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('table', { name: 'Corridas do mês' })).toBeVisible()
    await expect(inicio).toBeVisible()

    await abas(page).getByRole('link', { name: 'Pessoas' }).click()
    await expect(page).toHaveURL(/\/empresa\/pessoas$/)
    await expect(page.getByRole('heading', { name: 'Equipe' })).toBeVisible()
    await expect(abas(page).getByRole('link', { name: 'Pessoas' })).toHaveAttribute('aria-current', 'page')

    await abas(page).getByRole('link', { name: 'Carteira' }).click()
    await expect(page).toHaveURL(/\/empresa\/carteira$/)
    await expect(page.getByText('Disponível para novos pedidos')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Extrato' })).toBeVisible()
    await expect(inicio).toBeVisible()

    // Voltar volta pela aba anterior (nada de beco sem saída).
    await page.goBack()
    await expect(page).toHaveURL(/\/empresa\/pessoas$/)
    await inicio.click()
    await expect(page).toHaveURL(/127\.0\.0\.1:8789\/$/)
  })

  test('cada aba abre direto pelo endereço, com uma só marcação de página atual e um só h1', async ({ page }) => {
    await abrir(page, N1, '/empresa/carteira')
    await expect(abas(page).locator('[aria-current="page"]')).toHaveCount(1)
    await expect(abas(page).getByRole('link', { name: 'Carteira' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  })

  test('o menu ☰ "Painel da empresa" leva ao painel e continua marcado nas abas', async ({ page }) => {
    await abrir(page, N1, '/')
    await page.getByRole('button', { name: 'Abrir menu' }).click()
    await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Painel da empresa' }).click()
    await expect(page).toHaveURL(/\/empresa$/)
    await expect(page.getByRole('heading', { name: 'Resumo de outubro' })).toBeVisible()
    await abas(page).getByRole('link', { name: 'Corridas' }).click()
    await page.getByRole('button', { name: 'Abrir menu' }).click()
    await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name: 'Painel da empresa' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('o Master troca a empresa e continua na aba', async ({ page }) => {
    const chamadas = await abrir(page, ADM, '/empresa/corridas')
    const seletor = page.getByRole('combobox', { name: 'Empresa' })
    await expect(seletor).toHaveValue(EMPRESA_UMI.id)
    await expect(page.getByRole('table', { name: 'Corridas do mês' })).toBeVisible()
    await seletor.selectOption(EMPRESA_PORTO.id)
    await expect(page).toHaveURL(new RegExp(`/empresa/corridas\\?empresa=${EMPRESA_PORTO.id}$`))
    await expect.poll(() => chamadas.at(-1)).toEqual({ p_empresa: EMPRESA_PORTO.id, p_mes: null })
    // As outras abas levam a empresa junto.
    await abas(page).getByRole('link', { name: 'Carteira' }).click()
    await expect(page).toHaveURL(new RegExp(`/empresa/carteira\\?empresa=${EMPRESA_PORTO.id}$`))
    await expect(page.getByRole('combobox', { name: 'Empresa' })).toHaveValue(EMPRESA_PORTO.id)
  })

  test('Corridas mostra De → Paradas → Para e filtra por mês, status e centro de custo', async ({ page }) => {
    const chamadas = await abrir(page, N1, '/empresa/corridas')
    const tabela = page.getByRole('table', { name: 'Corridas do mês' })
    await expect(tabela.getByRole('row')).toHaveCount(4)
    const primeira = tabela.getByRole('row').nth(1)
    const rota = primeira.getByTestId('rota-de-para')
    await expect(rota).toContainText('DeUmi San · Rua Araguaia, 49')
    await expect(rota).toContainText('ParadaPosto Shell · BR-101')
    await expect(rota).toContainText('ParadaCliente Norte · Av. Brasil, 10')
    await expect(rota).toContainText('ParaPorto de Itajaí · Portão 3')
    await expect(primeira).toContainText('2,5 h')

    await page.getByLabel('Status').selectOption({ label: 'Cancelada' })
    await expect(tabela.getByRole('row')).toHaveCount(2)
    await expect(tabela.getByRole('row').nth(1)).toContainText('R$ 33,00')
    await page.getByLabel('Status').selectOption({ label: 'Todos' })

    await page.getByLabel('Centro de custo').selectOption({ label: 'Diretoria' })
    await expect(tabela.getByRole('row')).toHaveCount(2)
    await expect(tabela.getByRole('row').nth(1)).toContainText('Paulo Lima')
    await page.getByLabel('Centro de custo').selectOption({ label: 'Todos' })
    await expect(tabela.getByRole('row')).toHaveCount(4)

    // Outro mês: o banco devolve outro conjunto.
    await page.getByLabel('Mês').selectOption({ index: 1 })
    await expect.poll(() => chamadas.at(-1)?.p_mes).toMatch(/^\d{4}-\d{2}-01$/)
    await expect(tabela.getByRole('row')).toHaveCount(2)
    await expect(tabela.getByRole('row').nth(1)).toContainText('Carla Dias')
  })

  test('o CSV tem o cabeçalho exato e uma linha por corrida', async ({ page }) => {
    await abrir(page, N1, '/empresa/corridas')
    const baixando = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Exportar CSV' }).click()
    const arquivo = await baixando
    expect(arquivo.suggestedFilename()).toMatch(/^corridas-\d{4}-\d{2}\.csv$/)
    const texto = (await readFile((await arquivo.path())!, 'utf8')).replace(String.fromCharCode(0xfeff), '')
    const linhas = texto.split('\r\n')
    expect(linhas[0]).toBe('Data;Quem pediu;De;Paradas;Para;Categoria;Horas;Centro de custo;Valor')
    expect(linhas[1]).toBe(
      '02/10/2026;Marina Souza;Umi San · Rua Araguaia, 49;Posto Shell · BR-101 | Cliente Norte · Av. Brasil, 10;Porto de Itajaí · Portão 3;IVO Passageiros;2,5;"Obra; Galpão 2";220,00',
    )
    expect(linhas[2]).toBe(
      '05/10/2026;Marina Souza;Umi San · Rua Araguaia, 49;;Porto de Itajaí · Portão 3;IVO Passageiros;;Operações 4.100;33,00',
    )
    expect(linhas).toHaveLength(5)
  })

  test('o Painel também mostra De → Para nas listas', async ({ page }) => {
    await abrir(page, N1)
    const proximas = page.getByRole('table', { name: 'Próximas corridas' })
    await expect(proximas.getByTestId('rota-de-para').first()).toContainText('ParadaPosto Shell · BR-101')
    await expect(proximas.getByTestId('rota-de-para').first()).toContainText('ParaPorto de Itajaí · Portão 3')
  })
})

test.describe('no celular (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('as quatro abas cabem e as corridas viram cartões sem rolar para o lado', async ({ page }) => {
    await abrir(page, N1, '/empresa/corridas')
    await expect(abas(page).getByRole('link')).toHaveCount(4)
    await expect(page.getByRole('list', { name: 'Corridas do mês' }).getByTestId('cartao-corrida')).toHaveCount(3)
    await expect(page.getByTestId('rota-de-para').first()).toContainText('ParadaPosto Shell · BR-101')
    for (const aba of ['Pessoas', 'Carteira', 'Painel']) {
      await abas(page).getByRole('link', { name: aba }).click()
      const largura = await page.evaluate(() => ({ conteudo: document.documentElement.scrollWidth, tela: window.innerWidth }))
      expect(largura.conteudo).toBeLessThanOrEqual(largura.tela)
    }
  })
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })

    test('abas sem violações do axe nem de CSP', async ({ page }) => {
      const csp = await vigiarCsp(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.setViewportSize({ width: 1440, height: 900 })
      await abrir(page, N1, '/empresa/corridas')
      await expect(page.getByRole('table', { name: 'Corridas do mês' })).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await abas(page).getByRole('link', { name: 'Carteira' }).click()
      await expect(page.getByText('Disponível para novos pedidos')).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      expect(csp).toEqual([])
    })
  })
}
