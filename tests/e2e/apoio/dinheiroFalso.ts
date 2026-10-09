// Saldo, extrato, aprovação, cancelamento de agendado e painel simulados (fase 2B). Registrar DEPOIS de `simularApi`
// e `simularPedidos` (no Playwright a rota registrada por último vence).
import type { Page, Route } from '@playwright/test'
import { EMPRESA_PORTO, EMPRESA_UMI } from './apiFalsa.ts'
import { HISTORICO_ORCADO, ID_PEDIDO, SEM_ACOES, detalheFalso, orcamentoCliente } from './pedidosFalsos.ts'
import { json, URL_SUPABASE } from './sessaoFalsa.ts'

const HORA = 3600_000
const ha = (horas: number) => new Date(Date.now() - horas * HORA).toISOString()

export function saldoFalso(extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    empresa_id: EMPRESA_UMI.id,
    saldo_contabil_cent: 320000,
    reservado_cent: 71000,
    disponivel_cent: 249000,
    limite_cent: 100000,
    alerta_cent: 50000,
    abaixo_alerta: false,
    atualizado_em: ha(1),
    ...extra,
  }
}

type Item = Record<string, unknown>

function lancamento(id: number, tipo: string, valor: number, contabil: number, reservado: number, extra: Item = {}): Item {
  return {
    id,
    criado_em: ha(id),
    tipo,
    valor_cent: valor,
    efeito_contabil_cent: contabil,
    efeito_reservado_cent: reservado,
    numero: null,
    solicitante_nome: null,
    pode_abrir: false,
    atividade_id: null,
    estorna_id: null,
    ...extra,
  }
}

/** Extrato da Umi San: recarga, reserva/liberação/multa do pedido 42 (pode abrir) e débito do 39 (de um colega). */
export function extratoFalso(adm = false): Item[] {
  const p42 = { numero: 42, solicitante_nome: 'Diego Rocha', pode_abrir: true, atividade_id: ID_PEDIDO }
  const admin = (motivo: string | null, comprovante: string | null = null) =>
    adm ? { motivo, comprovante, criado_por_nome: motivo ? 'Ana Souza' : 'Diego Rocha' } : {}
  return [
    lancamento(1, 'MULTA', -35500, -35500, 0, { ...p42, ...admin('Multa de cancelamento do pedido nº 42 (50.00%)') }),
    lancamento(2, 'LIBERACAO_RESERVA', 71000, 0, -71000, { ...p42, ...admin(null) }),
    lancamento(3, 'RESERVA', 71000, 0, 71000, { ...p42, ...admin(null) }),
    lancamento(4, 'DEBITO', -180000, -180000, 0, { numero: 39, solicitante_nome: 'Elisa Prado', ...admin(null) }),
    lancamento(5, 'RECARGA', 500000, 500000, 0, admin('Pix de outubro', 'E2E-PIX-123')),
  ]
}

export function painelFalso(extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    periodo: { de: ha(24 * 8), ate: new Date().toISOString() },
    empresas: [
      { ...saldoFalso(), ok: undefined, empresa_id: EMPRESA_UMI.id, empresa_nome: 'Umi San', tem_contrato: true },
      {
        empresa_id: EMPRESA_PORTO.id,
        empresa_nome: 'Porto Azul',
        tem_contrato: true,
        saldo_contabil_cent: 20000,
        reservado_cent: 0,
        disponivel_cent: 20000,
        limite_cent: 0,
        alerta_cent: 50000,
        abaixo_alerta: true,
        atualizado_em: ha(3),
      },
    ],
    corridas: { agendadas: 3, em_andamento: 1 },
    aprovado: { total_cent: 213000, quantidade: 3 },
    pendencias: { aguardando_orcamento: 2, aguardando_aprovacao: 1, empresas_abaixo_alerta: 1 },
    ultima_reconciliacao: {
      id: 7,
      em: ha(6),
      ok: false,
      empresas: 2,
      divergencias_qtd: 1,
      divergencias: [{ tipo: 'AGENDADA_SEM_RESERVA', empresa_id: EMPRESA_PORTO.id, atividade_id: ID_PEDIDO }],
    },
    ...extra,
  }
}

export interface DinheiroFalso {
  /** Respostas de `saldo_empresa` em sequência (a última se repete). */
  saldos?: unknown[]
  /** Itens do extrato (o filtro de tipos é aplicado aqui, como no banco). */
  extrato?: Item[]
  painel?: unknown
  simulacao?: unknown
  /** Respostas das RPCs de escrita em sequência por nome; `'rede'` simula queda de conexão (sem resposta). */
  respostas?: Record<string, Array<unknown | 'rede'>>
  /** Atraso (ms) das escritas, para ver o estado "processando". */
  atrasoMs?: number
}

/** Registra as RPCs de dinheiro; devolve as chamadas recebidas (nome + corpo). */
export async function simularDinheiro(page: Page, opcoes: DinheiroFalso = {}) {
  const chamadas: Array<{ rpc: string; corpo: Record<string, unknown> }> = []
  const corpoDe = (route: Route) => (route.request().postDataJSON() ?? {}) as Record<string, unknown>
  const leitura = (nome: string, responder: (corpo: Record<string, unknown>) => unknown) =>
    page.route(`${URL_SUPABASE}/rest/v1/rpc/${nome}`, (route) => {
      const corpo = corpoDe(route)
      chamadas.push({ rpc: nome, corpo })
      return json(route, responder(corpo))
    })
  const saldos = [...(opcoes.saldos ?? [saldoFalso()])]
  await leitura('saldo_empresa', () => (saldos.length > 1 ? saldos.shift() : saldos[0]))
  await leitura('extrato', (c) => {
    const tipos = (c.p_filtro as { tipos?: string[] } | undefined)?.tipos
    const itens = opcoes.extrato ?? extratoFalso(c.p_empresa !== null && c.p_empresa !== undefined)
    return { ok: true, empresa_id: EMPRESA_UMI.id, itens: tipos ? itens.filter((i) => tipos.includes(String(i.tipo))) : itens }
  })
  await leitura('painel_adm', () => opcoes.painel ?? painelFalso())
  await leitura(
    'simular_cancelamento',
    () =>
      opcoes.simulacao ?? {
        ok: true,
        atividade_id: ID_PEDIDO,
        numero: 42,
        total_cent: 71000,
        liberado_cent: 71000,
        horas_antes: 10.5,
        faixa: { antecedencia_min_horas: 6, multa_bp: 5000 },
        multa_cent: 35500,
        cobra_multa: true,
        motivo_obrigatorio: false,
      },
  )
  const respostas = Object.fromEntries(Object.entries(opcoes.respostas ?? {}).map(([k, v]) => [k, [...v]]))
  const padrao: Record<string, unknown> = {
    aprovar_orcamento: { ok: true, atividade_id: ID_PEDIDO, reservado_cent: 71000, disponivel_cent: 178000 },
    cancelar_agendado: {
      ok: true,
      atividade_id: ID_PEDIDO,
      liberado_cent: 71000,
      multa_cent: 35500,
      faixa: { antecedencia_min_horas: 6, multa_bp: 5000 },
      disponivel_cent: 284500,
    },
    lancar_recarga: { ok: true, lancamento_id: 9, tipo: 'RECARGA', valor_cent: 150000, saldo_contabil_cent: 470000, reservado_cent: 71000, disponivel_cent: 399000 },
    lancar_ajuste: { ok: true, lancamento_id: 10, tipo: 'AJUSTE', valor_cent: -2550, saldo_contabil_cent: 317450, reservado_cent: 71000, disponivel_cent: 246450 },
    estornar_lancamento: { ok: true, lancamento_id: 11, tipo: 'ESTORNO', valor_cent: -500000, saldo_contabil_cent: -180000, reservado_cent: 71000, disponivel_cent: -251000 },
  }
  for (const nome of Object.keys(padrao)) {
    await page.route(`${URL_SUPABASE}/rest/v1/rpc/${nome}`, async (route) => {
      chamadas.push({ rpc: nome, corpo: corpoDe(route) })
      if (opcoes.atrasoMs) await new Promise((r) => setTimeout(r, opcoes.atrasoMs))
      const r = respostas[nome]?.shift() ?? padrao[nome]
      if (r === 'rede') return route.abort('internetdisconnected')
      return json(route, r)
    })
  }
  return chamadas
}

/** Detalhe do pedido 42 depois da aprovação (AGENDADA): quem decide pode cancelar o agendamento. */
export function pedidoAgendadoCliente(acoes: Record<string, boolean> = { cancelar_agendado: true }) {
  return {
    ok: true,
    pedido: detalheFalso({ status: 'AGENDADA' }),
    historico: [
      ...HISTORICO_ORCADO,
      { de: 'ORCADA', para: 'AGENDADA', em: ha(0.1), observacao: null, por_nome: 'Diego Rocha' },
    ],
    orcamento: orcamentoCliente({ status: 'APROVADO' }),
    acoes: { ...SEM_ACOES, ...acoes },
  }
}

/** Detalhe do pedido 42 cancelado depois de agendado. */
export function pedidoCanceladoCliente() {
  const agendado = pedidoAgendadoCliente({})
  return {
    ...agendado,
    pedido: detalheFalso({ status: 'CANCELADA' }),
    historico: [...agendado.historico, { de: 'AGENDADA', para: 'CANCELADA', em: ha(0), observacao: null, por_nome: 'Diego Rocha' }],
  }
}
