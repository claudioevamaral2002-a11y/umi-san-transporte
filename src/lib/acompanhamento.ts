// Regras puras do acompanhamento do cliente (Tarefa 9), sem React nem rede: a posição gravada no banco como posição da
// tela e a chegada prevista. As regras do sinal e da "última vence" ficam em rastreio.ts.
import type { Posicao } from './rastreio.ts'
import type { DetalhePedido } from './pedidos.ts'

const MIN = 60_000

/** A última posição gravada no banco (`api.pedido`) como posição da tela: o "agora" dela é a hora em que foi gravada. */
export function posicaoGravada(u: DetalhePedido['ultima_posicao']): Posicao | null {
  if (!u || !Number.isFinite(u.lat) || !Number.isFinite(u.lng) || Math.abs(u.lat) > 90 || Math.abs(u.lng) > 180) return null
  const em = Date.parse(u.em)
  if (Number.isNaN(em)) return null
  // seq -1: qualquer transmissão (seq 0 ou mais) vence a posição gravada.
  return { lat: u.lat, lng: u.lng, seq: -1, recebidaEm: em, eta: null }
}

/**
 * Chegada prevista (ISO): a do motorista, quando ele a transmitiu; senão, a saída mais o tempo da rota (uma estimativa,
 * para a tela não ficar em branco quando se abre no meio da viagem). `null` sem nenhuma das duas.
 */
export function chegadaPrevista(eta: string | null, saiuEm: string | null | undefined, minutosDaRota: number | null): string | null {
  if (eta) return eta
  if (!saiuEm || minutosDaRota === null) return null
  const saiu = Date.parse(saiuEm)
  return Number.isNaN(saiu) ? null : new Date(saiu + minutosDaRota * MIN).toISOString()
}
