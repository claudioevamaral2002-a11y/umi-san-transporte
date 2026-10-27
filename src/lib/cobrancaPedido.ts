// v2.2 (especificação §2, "Cancelada"): o que a lista e o detalhe dizem de um pedido encerrado sem serviço. O valor
// mostrado é o que foi lançado (a multa), nunca o orçamento: cancelada sem multa diz "Sem cobrança".
import type { Status } from '../design/componentes/StatusBadge.tsx'
import { formatarCentavos } from '../design/dinheiro.ts'
import { FINAIS_SEM_SERVICO } from './situacao.ts'

/**
 * "Sem cobrança" ou "Multa R$ 25,00" para CANCELADA, EXPIRADA, RECUSADA e REPROVADA; `null` nos outros status (a tela
 * mostra o total de sempre). Multa nula ou zero = sem cobrança.
 */
export function textoCobranca(status: Status, multa_cent: number | null | undefined): string | null {
  if (!FINAIS_SEM_SERVICO.includes(status)) return null
  return typeof multa_cent === 'number' && multa_cent > 0 ? `Multa ${formatarCentavos(multa_cent)}` : 'Sem cobrança'
}
