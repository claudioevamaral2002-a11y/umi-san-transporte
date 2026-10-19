// Ruling R12: no app novo, o detalhe de um pedido (/pedidos/:id, das listas reusadas do app atual) abre a tela nova
// quando ela existe para a situação; senão, o detalhe de hoje (Pedido.tsx) dentro da moldura nova.
import type { Papel } from '../lib/estadoSessao.ts'
import type { RespostaPedido } from '../lib/pedidos.ts'

/** Situações com tela nova do cliente (`/corrida/:id`: aguardando, confirmar, acompanhar e concluída). */
const DO_CLIENTE = new Set(['SOLICITADA', 'ORCADA', 'EM_ANDAMENTO', 'CONCLUIDA'])

/** Caminho da tela nova para este pedido e este papel, ou `null` (fica o detalhe de hoje). */
export function destinoNoAppNovo(papel: Papel, r: Pick<RespostaPedido, 'pedido' | 'acoes'>): string | null {
  const { id, status, modalidade } = r.pedido
  if (papel === 'CLIENTE') return DO_CLIENTE.has(status) ? `/corrida/${id}` : null
  if (papel === 'MOTORISTA') {
    // A chamada do app novo é só de veículo próprio; a diária (veículo do cliente) fica no Orçar de hoje.
    if (status === 'SOLICITADA' && r.acoes.orcar && modalidade === 'VEICULO_PROPRIO') return `/chamada/${id}`
    if (status === 'AGENDADA' && r.acoes.sair) return `/viagem/${id}`
    if (status === 'EM_ANDAMENTO' && r.acoes.concluir) return `/viagem/${id}`
    if (status === 'CONCLUIDA') return `/viagem/${id}`
  }
  return null
}
