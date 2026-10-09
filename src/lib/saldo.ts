// Saldo, extrato, aprovação, cancelamento de agendado e painel do ADM (fase 2B). O banco decide e calcula tudo;
// a tela só mostra o que o servidor confirmou (especificação 12.2: nenhuma ação financeira é otimista). As únicas
// contas feitas aqui são de EXIBIÇÃO (ex.: "saldo depois da aprovação" no recibo) e nunca vão ao banco.
import type { RespostaRpc } from './api.ts'
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
  cancelarAgendado: (atividade: string, motivo: string | null, chave: string) =>
    chamar('cancelar_agendado', { p_atividade: atividade, p_motivo: motivo, p_chave: chave }),
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

// ------------------------------------------------------------------------------------------------
// Idempotência no front: uma chave por INTENÇÃO
// ------------------------------------------------------------------------------------------------

/**
 * Chave de idempotência da intenção atual. A mesma `assinatura` (o que a pessoa confirmou: alvo + valores) devolve
 * a mesma chave — uma nova tentativa depois de erro de rede não duplica o efeito (o banco devolve o resultado
 * original). Mudou o que vai ser feito: chave nova. Depois do sucesso, `encerrar()` (a próxima intenção é outra).
 */
export class Intencao {
  private atual: { assinatura: string; chave: string } | null = null

  constructor(private readonly gerar: () => string = () => crypto.randomUUID()) {}

  chave(assinatura: string): string {
    if (!this.atual || this.atual.assinatura !== assinatura) this.atual = { assinatura, chave: this.gerar() }
    return this.atual.chave
  }

  encerrar() {
    this.atual = null
  }
}

/** Falha sem resposta do servidor (rede): o efeito pode ter acontecido; tentar de novo com a MESMA chave. */
export const semResposta = (r: RespostaRpc) => !r.ok && r.codigo === 'ERRO_INESPERADO'

// ------------------------------------------------------------------------------------------------
// Contas só de exibição
// ------------------------------------------------------------------------------------------------

/**
 * Recibo da aprovação: disponível depois de reservar o total e se cabe no limite (só para mostrar; quem decide é o
 * banco, que pode ter visto outro saldo). `falta_cent` > 0 quando não cabe.
 */
export function saldoAposAprovacao(saldo: Pick<Saldo, 'disponivel_cent' | 'limite_cent'>, totalCent: number) {
  const depois = saldo.disponivel_cent - totalCent
  const falta = Math.max(0, -(depois + saldo.limite_cent))
  return { disponivel_depois_cent: depois, cabe: falta === 0, falta_cent: falta, usa_credito: depois < 0 }
}

/** Saldo depois de um lançamento manual do ADM (recarga/ajuste/estorno) — só para a confirmação. */
export function saldoAposLancamento(saldo: Pick<Saldo, 'disponivel_cent' | 'saldo_contabil_cent'>, efeitoCent: number) {
  return {
    disponivel_depois_cent: saldo.disponivel_cent + efeitoCent,
    contabil_depois_cent: saldo.saldo_contabil_cent + efeitoCent,
  }
}

/** Barra disponível/reservado: fração (0–1) do reservado sobre o que a empresa tem comprometido + livre. */
export function fracaoReservada(saldo: Pick<Saldo, 'disponivel_cent' | 'reservado_cent'>): number {
  const livre = Math.max(0, saldo.disponivel_cent)
  const total = livre + saldo.reservado_cent
  return total <= 0 ? 0 : saldo.reservado_cent / total
}

/** Empresas por risco: abaixo do alerta primeiro, depois do menor disponível (contando o limite) para o maior. */
export function ordenarPorRisco<T extends Pick<EmpresaPainel, 'abaixo_alerta' | 'disponivel_cent' | 'limite_cent' | 'empresa_nome'>>(
  empresas: readonly T[],
): T[] {
  return [...empresas].sort(
    (a, b) =>
      Number(b.abaixo_alerta) - Number(a.abaixo_alerta) ||
      a.disponivel_cent + a.limite_cent - (b.disponivel_cent + b.limite_cent) ||
      a.empresa_nome.localeCompare(b.empresa_nome, 'pt-BR'),
  )
}

/** "Android · Chrome", "iPhone · Safari", "Windows · Edge" — só o necessário para o registro da aprovação. */
export function resumoDispositivo(ua: string): string {
  const sistema = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Outro sistema'
  const navegador = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser\//.test(ua)
      ? 'Samsung Internet'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Firefox\/|FxiOS\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Outro navegador'
  return `${sistema} · ${navegador} · app IVO`
}
