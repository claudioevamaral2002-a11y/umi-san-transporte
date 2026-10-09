// Rótulos e etapas dos pedidos (puros). Textos sem nome de empresa na modalidade (Adendo A10).
import type { Status } from '../design/componentes/StatusBadge.tsx'

export type Carga = 'PESSOAS' | 'EQUIPAMENTO' | 'AMBOS'
export type Modalidade = 'VEICULO_PROPRIO' | 'VEICULO_CLIENTE'
export type Reboque = 'SIM' | 'NAO' | 'NAO_SEI'

export const ROTULO_CARGA: Record<Carga, string> = { PESSOAS: 'Pessoas', EQUIPAMENTO: 'Equipamento', AMBOS: 'Ambos' }
export const ROTULO_MODALIDADE: Record<Modalidade, string> = {
  VEICULO_PROPRIO: 'Veículo próprio',
  VEICULO_CLIENTE: 'Veículo do cliente',
}
export const ROTULO_REBOQUE: Record<Reboque, string> = { SIM: 'Sim', NAO: 'Não', NAO_SEI: 'Não sei' }

/** Levar + Trazer = ida e volta. */
export function rotuloTrajeto(levar: boolean, trazer: boolean): string {
  if (levar && trazer) return 'Levar e trazer (ida e volta)'
  if (levar) return 'Só levar'
  if (trazer) return 'Só trazer'
  return 'Trajeto não informado'
}

/** Pedido em aberto com prazo vencido (antes do cron) aparece como expirado. */
export function statusExibido(status: Status, prazoVencido: boolean): Status {
  return prazoVencido && (status === 'SOLICITADA' || status === 'ORCADA') ? 'EXPIRADA' : status
}

export const ETAPAS = ['Solicitado', 'Orçado', 'Agendado', 'Saiu', 'Concluído'] as const

const INDICE: Partial<Record<Status, number>> = { SOLICITADA: 0, ORCADA: 1, AGENDADA: 2, EM_ANDAMENTO: 3, CONCLUIDA: 4 }

export const FINAIS_SEM_SERVICO: readonly Status[] = ['RECUSADA', 'REPROVADA', 'EXPIRADA', 'CANCELADA']

/**
 * Linha do tempo estilo rastreio: até qual etapa o pedido chegou e, se terminou sem serviço, em qual status.
 * Encerrado sem serviço: a etapa alcançada é a do status de onde saiu (último `de` do histórico).
 */
export function etapaDoPedido(
  status: Status,
  historico: Array<{ de: Status | null; para: Status }>,
): { atual: number; encerrado: Status | null } {
  const direto = INDICE[status]
  if (direto !== undefined) return { atual: direto, encerrado: null }
  const saida = [...historico].reverse().find((h) => h.para === status)
  const de = saida?.de ? (INDICE[saida.de] ?? 0) : 0
  return { atual: de, encerrado: status }
}

/** Grupos de filtro da lista de pedidos. */
export const FILTROS = {
  abertos: { rotulo: 'Em aberto', status: ['SOLICITADA', 'ORCADA'] },
  agendados: { rotulo: 'Agendados', status: ['AGENDADA', 'EM_ANDAMENTO'] },
  encerrados: { rotulo: 'Encerrados', status: ['CONCLUIDA', 'RECUSADA', 'REPROVADA', 'EXPIRADA', 'CANCELADA'] },
} as const satisfies Record<string, { rotulo: string; status: Status[] }>

export type Filtro = keyof typeof FILTROS
