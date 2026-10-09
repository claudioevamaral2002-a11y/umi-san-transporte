// Partes puras do saldo (sem cliente do Supabase): idempotência por intenção e contas só de exibição.
import type { RespostaRpc } from './api.ts'
import type { EmpresaPainel, Saldo } from './saldo.ts'

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

/**
 * Tipos de divergência da reconciliação diária (`interno.reconciliar`, migration 20261009141000) com o texto do
 * painel do ADM. O RUNBOOK ("Divergência de saldo") explica cada um.
 */
export const ROTULO_DIVERGENCIA = {
  CONTA_DIVERGENTE: 'Saldo da conta diferente do livro-razão',
  RESERVA_FORA_DE_AGENDADA: 'Reserva ativa em pedido que não está agendado',
  AGENDADA_SEM_RESERVA: 'Pedido agendado sem reserva',
  AGENDADA_SEM_APROVACAO: 'Pedido agendado sem aprovação registrada',
  RESERVA_SEM_PAR: 'Reserva sem o lançamento de reserva/liberação correspondente',
  RESERVA_VALOR_DIVERGENTE: 'Lançamento de reserva com valor diferente da reserva',
  EMPRESA_DIVERGENTE: 'Lançamento ou reserva ligado a pedido de outra empresa',
  ESTORNO_DIVERGENTE: 'Estorno que não é o inverso exato do lançamento original',
  COBRANCA_SEM_APROVACAO: 'Cobrança sem aprovação registrada',
  COBRANCA_DUPLICADA: 'Cobrança duplicada no mesmo pedido',
} as const satisfies Record<string, string>

export function rotuloDivergencia(tipo: string): string {
  return (ROTULO_DIVERGENCIA as Record<string, string>)[tipo] ?? tipo
}
