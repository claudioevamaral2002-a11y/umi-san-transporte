// v2.1 (Tarefa 8, lado do cliente): empresa no Faturado (NF). O início nunca mostra "sem crédito", a confirmação diz
// "Será cobrada na fatura da quinzena (NF)" sem o saldo, e a corrida confirmada "Entra na fatura da quinzena quando a
// corrida começar". No Crédito, tudo como hoje. A forma vem de `saldo_empresa.forma_cobranca` (sem ela, Crédito).
// Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { simularApi } from './apoio/apiFalsa.ts'
import { saldoFalso } from './apoio/dinheiroFalso.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import { detalheFalso, ID_PEDIDO, SEM_ACOES, simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE } from './apoio/sessaoFalsa.ts'

const TELA = { width: 390, height: 844 }
const SEM_CREDITO = 'Sua empresa está sem crédito. Fale com a IVO Transportes para recarregar.'

/** Faturado: o banco devolve limite e alerta zerados e o disponível negativo (o valor devido). */
const FATURADO = { forma_cobranca: 'FATURADO', saldo_contabil_cent: -450000, reservado_cent: 22000, disponivel_cent: -472000, limite_cent: 0, alerta_cent: 0 }
/** Crédito sem crédito nenhum (a mesma conta, sem a forma): o início bloqueia como hoje. */
const CREDITO_ZERADO = { saldo_contabil_cent: -100000, reservado_cent: 0, disponivel_cent: -100000, limite_cent: 100000, abaixo_alerta: true }

function orcada(acoes: Record<string, boolean> = { aprovar: true, pedir_revisao: true, reprovar: true, cancelar: true }) {
  return {
    ok: true,
    pedido: detalheFalso({
      status: 'ORCADA',
      categoria: 'PASSAGEIROS',
      categoria_nome: 'IVO Passageiros',
      motorista_nome: 'Ivo Barbosa',
      veiculo: { modelo: 'Hilux', cor: 'branca', placa: 'ABC1D23' },
      origem: 'Estaleiro Navegantes',
      destino: 'Porto de Itajaí',
      origem_place_id: 'ChIJdef',
      destino_place_id: 'ChIJpor',
      carga: 'PESSOAS',
      centro_custo: null,
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
      total_cent: 22000,
      hash: 'b'.repeat(64),
    },
    acoes: { ...SEM_ACOES, ...acoes },
  }
}

function agendada() {
  const o = orcada({})
  return { ...o, pedido: { ...o.pedido, status: 'AGENDADA' }, orcamento: { ...o.orcamento, status: 'APROVADO' } }
}

async function abrir(page: Page, o: { saldo: Record<string, unknown>; detalhes?: unknown[]; caminho?: string }) {
  await page.setViewportSize(TELA)
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  const chamadas = await simularPedidos(page, { detalhes: o.detalhes })
  await simularMapas(page, { rota: { km: 42, minutos: 55 }, polyline: '_p~iF~ps|U_ulLnnqC' })
  await simularBlocosDoMapa(page)
  // Registrada depois de `simularApi`: esta resposta vale.
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/saldo_empresa`, (route: Route) => json(route, saldoFalso(o.saldo)))
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/categorias_disponiveis`, (route: Route) =>
    json(route, {
      ok: true,
      categorias: [{ codigo: 'PASSAGEIROS', nome: 'IVO Passageiros', descricao_curta: 'até 4 pessoas', disponivel: true, total_cent: 22000, linhas: [] }],
    }),
  )
  const confirmar: Array<Record<string, unknown>> = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/confirmar_corrida`, (route: Route) => {
    confirmar.push(route.request().postDataJSON() as Record<string, unknown>)
    return json(route, { ok: true, atividade_id: ID_PEDIDO, reservado_cent: 22000, disponivel_cent: -494000 })
  })
  await page.goto(o.caminho ?? '/')
  return { chamadas, confirmar }
}

const semRolagemLateral = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test.describe('empresa no Faturado (NF)', () => {
  test('o início nunca mostra "sem crédito", mesmo com o saldo negativo', async ({ page }) => {
    await abrir(page, { saldo: FATURADO })
    await expect(page.getByRole('combobox', { name: 'De', exact: true })).toBeVisible()
    await expect(page.getByTestId('pedido-indisponivel')).toHaveCount(0)
    await expect(page.getByText(SEM_CREDITO)).toHaveCount(0)
  })

  test('a confirmação diz "Será cobrada na fatura da quinzena (NF)", sem o saldo nem o aviso de falta', async ({ page }) => {
    const { confirmar } = await abrir(page, { saldo: FATURADO, detalhes: [orcada(), agendada()], caminho: `/corrida/${ID_PEDIDO}` })
    const folha = page.getByTestId('folha-mapa')
    await expect(folha).toContainText('Será cobrada na fatura da quinzena (NF)')
    await expect(folha).not.toContainText('Disponível no saldo')
    await expect(folha).not.toContainText('faltariam')
    expect(await semRolagemLateral(page)).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])

    await page.getByRole('button', { name: 'Confirmar corrida · R$ 220' }).click()
    await expect.poll(() => confirmar.length).toBe(1)
    await expect(page.getByRole('heading', { name: 'Corrida confirmada' })).toBeVisible()
    await expect(folha).toContainText('Entra na fatura da quinzena quando a corrida começar')
    await expect(folha).not.toContainText('Reservado no saldo')
    await expect(folha).not.toContainText('fica reservado')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })

  test('a corrida já agendada: "Entra na fatura da quinzena quando a corrida começar"', async ({ page }) => {
    await abrir(page, { saldo: FATURADO, detalhes: [agendada()], caminho: `/corrida/${ID_PEDIDO}` })
    const folha = page.getByTestId('folha-mapa')
    await expect(folha).toContainText('Entra na fatura da quinzena quando a corrida começar')
    await expect(folha).not.toContainText('A cobrança acontece na saída do Ivo')
    expect(await semRolagemLateral(page)).toBe(true)
  })
})

test.describe('empresa no Crédito: como hoje', () => {
  test('sem crédito nenhum, o início explica e não deixa pedir', async ({ page }) => {
    await abrir(page, { saldo: CREDITO_ZERADO })
    await expect(page.getByTestId('pedido-indisponivel')).toContainText(SEM_CREDITO)
    await expect(page.getByRole('combobox', { name: 'De', exact: true })).toHaveCount(0)
  })

  test('a confirmação mostra o disponível e a corrida confirmada o reservado', async ({ page }) => {
    await abrir(page, { saldo: { forma_cobranca: 'CREDITO' }, detalhes: [orcada(), agendada()], caminho: `/corrida/${ID_PEDIDO}` })
    const folha = page.getByTestId('folha-mapa')
    await expect(folha).toContainText('Disponível no saldo: R$ 2.490,00')
    await expect(folha).not.toContainText('Será cobrada na fatura')
    await page.getByRole('button', { name: 'Confirmar corrida · R$ 220' }).click()
    await expect(page.getByRole('heading', { name: 'Corrida confirmada' })).toBeVisible()
    await expect(folha).toContainText('Reservado no saldo')
    await expect(folha).toContainText('A cobrança acontece na saída do Ivo. O valor fica reservado até lá.')
    await expect(folha).not.toContainText('Entra na fatura')
  })
})
