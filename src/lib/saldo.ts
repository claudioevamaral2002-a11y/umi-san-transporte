// Saldo, extrato, aprovação, cancelamento de agendado e painel do ADM (fase 2B). O banco decide e calcula tudo;
// a tela só mostra o que o servidor confirmou (especificação 12.2: nenhuma ação financeira é otimista). As únicas
// contas feitas aqui são de EXIBIÇÃO (ex.: "saldo depois da aprovação" no recibo) e nunca vão ao banco.
import type { RespostaRpc } from './api.ts'
import type { FormaCobranca } from './contratos.ts'
import { ErroLeitura } from './pedidos.ts'
import { supabase } from './supabase.ts'

export interface Saldo {
  empresa_id: string
  saldo_contabil_cent: number
  reservado_cent: number
  disponivel_cent: number
  /** Limite de saldo negativo do contrato vigente (0 sem contrato). */
  limite_cent: number
  alerta_cent: number
  abaixo_alerta: boolean
  atualizado_em: string | null
  /** v2.1 (opcional: o banco anterior não devolvia; sem ela, Crédito). No Faturado, o saldo negativo é o "Em aberto". */
  forma_cobranca?: FormaCobranca
}

export const TIPOS_LANCAMENTO = [
  'RECARGA',
  'DEBITO',
  'MULTA',
  'ADITIVO',
  'AJUSTE',
  'ESTORNO',
  'RESERVA',
  'LIBERACAO_RESERVA',
  // v2.1: pagamento de fatura (crédito igual ao total; nunca entra numa fatura nem é estornado).
  'PAGAMENTO_FATURA',
] as const
export type TipoLancamento = (typeof TIPOS_LANCAMENTO)[number]

export interface ItemExtrato {
  id: number
  criado_em: string
  tipo: TipoLancamento
  valor_cent: number
  efeito_contabil_cent: number
  efeito_reservado_cent: number
  numero: number | null
  solicitante_nome: string | null
  pode_abrir: boolean
  atividade_id: string | null
  estorna_id: number | null
  /** Só para o ADM. */
  motivo?: string | null
  comprovante?: string | null
  criado_por_nome?: string | null
}

export interface FiltroExtrato {
  de?: string
  ate?: string
  tipos?: TipoLancamento[]
  limite?: number
}

export interface EmpresaPainel extends Saldo {
  empresa_nome: string
  tem_contrato: boolean
}

export interface Divergencia {
  tipo: string
  empresa_id?: string
  atividade_id?: string
  [campo: string]: unknown
}

export interface Painel {
  periodo: { de: string; ate: string }
  empresas: EmpresaPainel[]
  corridas: { agendadas: number; em_andamento: number }
  aprovado: { total_cent: number; quantidade: number }
  pendencias: { aguardando_orcamento: number; aguardando_aprovacao: number; empresas_abaixo_alerta: number }
  ultima_reconciliacao: {
    id: number
    em: string
    ok: boolean
    empresas: number
    divergencias_qtd: number
    divergencias: Divergencia[]
  } | null
}

export interface Simulacao {
  atividade_id: string
  numero: number
  total_cent: number
  liberado_cent: number
  horas_antes: number
  faixa: { antecedencia_min_horas: number; multa_bp: number } | null
  multa_cent: number
  cobra_multa: boolean
  motivo_obrigatorio: boolean
}

async function chamar(nome: string, args: Record<string, unknown>): Promise<RespostaRpc> {
  try {
    const { data, error } = await supabase.rpc(nome, args)
    if (error || !data || typeof data !== 'object' || typeof (data as RespostaRpc).ok !== 'boolean') {
      return { ok: false, codigo: 'ERRO_INESPERADO' }
    }
    return data as RespostaRpc
  } catch {
    return { ok: false, codigo: 'ERRO_INESPERADO' }
  }
}

async function ler<T>(nome: string, args: Record<string, unknown>): Promise<T> {
  const r = await chamar(nome, args)
  if (!r.ok) throw new ErroLeitura(r.codigo ?? 'ERRO_INESPERADO')
  return r as unknown as T
}

export const dinheiro = {
  /** Cliente: a própria empresa (`null`); ADM: a empresa pedida. */
  saldo: (empresa: string | null = null) => ler<Saldo>('saldo_empresa', { p_empresa: empresa }),

  extrato: async (empresa: string | null, filtro: FiltroExtrato) =>
    (await ler<{ itens: ItemExtrato[] }>('extrato', { p_empresa: empresa, p_filtro: filtro })).itens,

  painel: (de: Date | null, ate: Date | null) =>
    ler<Painel>('painel_adm', { p_de: de?.toISOString() ?? null, p_ate: ate?.toISOString() ?? null }),

  simularCancelamento: (atividade: string) => ler<Simulacao>('simular_cancelamento', { p_atividade: atividade }),

  // Ações com chave de idempotência (uma por intenção; repetida na nova tentativa da mesma intenção).
  aprovar: (atividade: string, versao: number, hash: string, chave: string, dispositivo: string | null) =>
    chamar('aprovar_orcamento', {
      p_atividade: atividade,
      p_versao: versao,
      p_hash: hash,
      p_chave: chave,
      p_dispositivo: dispositivo,
    }),
  /** `multaEsperada`: a multa_cent da prévia que o cliente viu (obrigatória para o cliente; null para o prestador). */
  cancelarAgendado: (atividade: string, motivo: string | null, chave: string, multaEsperada: number | null) =>
    chamar('cancelar_agendado', {
      p_atividade: atividade,
      p_motivo: motivo,
      p_chave: chave,
      p_multa_esperada_cent: multaEsperada,
    }),
  recarga: (empresa: string, valorCent: number, motivo: string, comprovante: string | null, chave: string) =>
    chamar('lancar_recarga', {
      p_empresa: empresa,
      p_valor_cent: valorCent,
      p_motivo: motivo,
      p_comprovante: comprovante,
      p_chave: chave,
    }),
  ajuste: (empresa: string, valorCent: number, motivo: string, chave: string) =>
    chamar('lancar_ajuste', { p_empresa: empresa, p_valor_cent: valorCent, p_motivo: motivo, p_chave: chave }),
  estorno: (lancamento: number, motivo: string, chave: string) =>
    chamar('estornar_lancamento', { p_lancamento: lancamento, p_motivo: motivo, p_chave: chave }),
}

export { Intencao, fracaoReservada, ordenarPorRisco, resumoDispositivo, saldoAposAprovacao, saldoAposLancamento, semResposta } from './saldoExibicao.ts'
