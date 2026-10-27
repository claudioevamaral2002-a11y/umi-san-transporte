// v2.2 (Tarefa 4, especificação §2 "Cancelada", §5.2 e §5.3): cancelada ou expirada abre a tela "Encerrada" com o que
// de fato foi lançado ("Cancelada sem cobrança · reserva de R$ X devolvida" ou "Multa R$ X"), o motivo, o resumo, o
// "Orçamento (não cobrado)" e o histórico. A lista diz o mesmo ("Sem cobrança" / "Multa R$ X") no lugar do orçamento, e
// o detalhe de hoje (recusada/reprovada) mostra o selo e esconde "Se precisar cancelar depois de aprovado".
// Roda no projeto Playwright `novo` (dist-novo).
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { simularApi, vigiarCsp } from './apoio/apiFalsa.ts'
import { simularBlocosDoMapa, simularMapas } from './apoio/mapasFalsos.ts'
import {
  detalheFalso,
  HISTORICO_ORCADO,
  ID_PEDIDO,
  ID_PEDIDO_2,
  itemLista,
  orcamentoCliente,
  SEM_ACOES,
  simularPedidos,
  type PedidosFalsos,
} from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa } from './apoio/sessaoFalsa.ts'

const TELA = { width: 390, height: 844 }
const AGORA = new Date().toISOString()

const AGENDADO = { de: 'ORCADA', para: 'AGENDADA', em: AGORA, observacao: null, por_nome: 'Diego Rocha' }

/** Cancelada depois de agendada: orçamento aprovado de R$ 710,00 e a cobrança lançada. */
function cancelada(cobranca: Record<string, unknown> | null, motivo: string | null = 'Obra adiada pelo cliente') {
  return {
    ok: true,
    pedido: detalheFalso({ status: 'CANCELADA', centro_custo: 'Obra Norte' }),
    historico: [...HISTORICO_ORCADO, AGENDADO, { de: 'AGENDADA', para: 'CANCELADA', em: AGORA, observacao: motivo, por_nome: 'Diego Rocha' }],
    orcamento: orcamentoCliente({ status: 'APROVADO' }),
    acoes: SEM_ACOES,
    cobranca,
  }
}

async function abrir(page: Page, caminho: string, pedidos: PedidosFalsos) {
  await page.setViewportSize(TELA)
  await comSessaoFalsa(page, { papel: 'CLIENTE', nivel: 2, nome: 'Diego Rocha', empresa_nome: 'Umi San' })
  await simularApi(page)
  await simularPedidos(page, pedidos)
  await simularMapas(page, { rota: { km: 42, minutos: 55 }, polyline: '_p~iF~ps|U_ulLnnqC' })
  await simularBlocosDoMapa(page)
  await page.goto(caminho)
}

const semRolagemLateral = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('cancelada sem multa: "Cancelada sem cobrança · reserva devolvida", motivo, resumo, orçamento não cobrado e histórico', async ({ page }) => {
  await abrir(page, `/pedidos/${ID_PEDIDO}`, {
    detalhes: [cancelada({ debito_cent: null, multa_cent: null, liberado_cent: 71000 })],
  })
  await expect(page).toHaveURL(new RegExp(`/corrida/${ID_PEDIDO}$`))
  const resultado = page.getByRole('heading', { level: 1 })
  await expect(resultado).toHaveText(/^Cancelada sem cobrança · reserva de R\$\s710,00 devolvida$/)
  const folha = page.getByTestId('folha-mapa')
  await expect(folha).toContainText('Motivo: Obra adiada pelo cliente')
  await expect(page.getByTestId('numero-pedido')).toHaveText('Pedido #0042')
  await expect(page.getByTestId('detalhes-pedido')).toBeVisible()
  const orcamento = page.getByRole('region', { name: 'Orçamento (não cobrado)' })
  await expect(orcamento).toBeVisible()
  await expect(orcamento.getByTestId('memorial')).toBeVisible()
  await expect(folha).not.toContainText('Se precisar cancelar depois')
  await expect(page.getByTestId('historico').locator('li')).toHaveCount(4)
  expect(await semRolagemLateral(page)).toBe(true)
})

test('cancelada com multa: "Multa R$ X" no topo, sem dizer "sem cobrança"', async ({ page }) => {
  await abrir(page, `/corrida/${ID_PEDIDO}`, {
    detalhes: [cancelada({ debito_cent: null, multa_cent: 14200, liberado_cent: 71000 })],
  })
  const resultado = page.getByRole('heading', { level: 1 })
  await expect(resultado).toHaveText(/^Multa R\$\s142,00 · reserva de R\$\s710,00 devolvida$/)
  await expect(page.getByTestId('folha-mapa')).not.toContainText('sem cobrança')
  // Sem débito da corrida: o orçamento continua "não cobrado".
  await expect(page.getByRole('region', { name: 'Orçamento (não cobrado)' })).toBeVisible()
})

test('expirada sem orçamento nem cobrança lançada: "Cancelada sem cobrança", sem o bloco do orçamento', async ({ page }) => {
  const expirada = {
    ok: true,
    pedido: detalheFalso({ status: 'EXPIRADA', prazo_vencido: true }),
    historico: [HISTORICO_ORCADO[0], { de: 'SOLICITADA', para: 'EXPIRADA', em: AGORA, observacao: null, por_nome: null }],
    orcamento: null,
    acoes: SEM_ACOES,
    cobranca: { debito_cent: null, multa_cent: null, liberado_cent: null },
  }
  await abrir(page, `/pedidos/${ID_PEDIDO}`, { detalhes: [expirada] })
  await expect(page).toHaveURL(new RegExp(`/corrida/${ID_PEDIDO}$`))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cancelada sem cobrança')
  await expect(page.getByTestId('folha-mapa')).not.toContainText('Motivo:')
  await expect(page.getByRole('region', { name: 'Orçamento (não cobrado)' })).toHaveCount(0)
})

test('lista: encerrada mostra "Sem cobrança" ou "Multa R$ X" no lugar do orçamento', async ({ page }) => {
  const lista = [
    itemLista({ status: 'CANCELADA', total_cent: 71000, multa_cent: null }),
    itemLista({ id: ID_PEDIDO_2, numero: 41, status: 'CANCELADA', total_cent: 71000, multa_cent: 14200 }),
    itemLista({ id: '00000000-0000-4000-8000-0000000000a3', numero: 40, status: 'CONCLUIDA', total_cent: 71000 }),
  ]
  await abrir(page, '/pedidos?filtro=encerrados', { lista })
  const cartoes = page.getByTestId('lista-pedidos').getByRole('link')
  await expect(cartoes).toHaveCount(3)
  await expect(cartoes.nth(0).getByTestId('cobranca-pedido')).toHaveText('Sem cobrança')
  await expect(cartoes.nth(0)).not.toContainText('710,00')
  await expect(cartoes.nth(1).getByTestId('cobranca-pedido')).toHaveText(/^Multa R\$\s142,00$/)
  await expect(cartoes.nth(1)).not.toContainText('710,00')
  // Concluída: o total de sempre.
  await expect(cartoes.nth(2)).toContainText('710,00')
  await expect(cartoes.nth(2).getByTestId('cobranca-pedido')).toHaveCount(0)
  expect(await semRolagemLateral(page)).toBe(true)
})

test('detalhe de hoje (reprovada): o selo "Sem cobrança" e nada de "Se precisar cancelar depois de aprovado"', async ({ page }) => {
  const reprovada = {
    ok: true,
    pedido: detalheFalso({ status: 'REPROVADA' }),
    historico: [...HISTORICO_ORCADO, { de: 'ORCADA', para: 'REPROVADA', em: AGORA, observacao: null, por_nome: 'Diego Rocha' }],
    orcamento: orcamentoCliente({ status: 'REPROVADO' }),
    acoes: SEM_ACOES,
    cobranca: null,
  }
  await abrir(page, `/pedidos/${ID_PEDIDO}`, { detalhes: [reprovada] })
  await expect(page.getByRole('heading', { name: 'Pedido #0042' })).toBeVisible()
  await expect(page.getByTestId('selo-cobranca')).toHaveText('Sem cobrança')
  await expect(page.getByTestId('orcamento-recebido')).toBeVisible()
  await expect(page.getByText('Se precisar cancelar depois de aprovado')).toHaveCount(0)
  expect(await semRolagemLateral(page)).toBe(true)
})

for (const tema of ['light', 'dark'] as const) {
  test.describe(`tema ${tema === 'light' ? 'claro' : 'escuro'}`, () => {
    test.use({ colorScheme: tema })

    test('encerrada e lista: sem violações do axe nem de CSP', async ({ page }) => {
      const csp = await vigiarCsp(page)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await abrir(page, `/corrida/${ID_PEDIDO}`, {
        detalhes: [cancelada({ debito_cent: null, multa_cent: 14200, liberado_cent: 71000 })],
        lista: [itemLista({ status: 'CANCELADA', total_cent: 71000, multa_cent: null })],
      })
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Multa')
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await page.goto('/pedidos?filtro=encerrados')
      await expect(page.getByTestId('cobranca-pedido')).toHaveText('Sem cobrança')
      // A etiqueta de status da lista de hoje tem a exceção de contraste já anotada (fase 4, Tarefa 11).
      expect((await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze()).violations).toEqual([])
      expect(csp).toEqual([])
    })
  })
}
