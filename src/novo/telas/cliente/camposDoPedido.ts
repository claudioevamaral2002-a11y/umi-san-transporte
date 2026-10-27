import { MAX_PARADAS } from '../../../lib/paradas.ts'
import { temPontoNaRota } from '../../../lib/pontoRota.ts'
import type { ValorEndereco } from '../../../telas/pedidos/CampoEndereco.tsx'
import type { EnderecoEscolhido } from './EscolherCategoria.tsx'

/**
 * v2.2 (auditoria A03): os endereços do início do cliente num estado só, mudado **por campo** a partir do valor mais
 * recente (`setCampos((c) => mudarCampo(c, …))`). Antes, cada campo regravava os três com valores de um render antigo:
 * a origem que terminava de carregar depois de o cliente digitar o Para apagava o Para.
 */
export interface CamposDoPedido {
  origem: ValorEndereco
  /** Paradas na ordem; `ids[i]` é a identidade estável da parada `i` (a `key` do campo). */
  paradas: ValorEndereco[]
  ids: number[]
  destino: ValorEndereco
  /** Todos os pontos com local: a tela passa à escolha da categoria. */
  escolhendo: boolean
}

/** O campo mudado: a origem, o destino ou a parada de identidade `parada` (não o índice, que muda ao remover). */
export type CampoDoPedido = 'origem' | 'destino' | { parada: number }

export const VAZIO: ValorEndereco = { texto: '', local: null }

/** O endereço tem ponto na rota (a regra de `pontoRota.ts`). */
export const temPonto = (v: ValorEndereco): v is EnderecoEscolhido => temPontoNaRota(v.local)

/** Todos os pontos com local (origem, cada parada e destino): dá para traçar a rota e ver as categorias. */
export const completo = (c: Pick<CamposDoPedido, 'origem' | 'paradas' | 'destino'>) =>
  temPonto(c.origem) && temPonto(c.destino) && c.paradas.every(temPonto)

/**
 * Muda só o campo `campo` para `v`; os outros ficam como estão no estado recebido (o atual). Se o campo ganhou um ponto
 * e todos têm ponto, passa à escolha da categoria. Uma parada que já foi removida (resposta atrasada) não muda nada.
 */
export function mudarCampo(c: CamposDoPedido, campo: CampoDoPedido, v: ValorEndereco): CamposDoPedido {
  let n: CamposDoPedido
  let antes: ValorEndereco
  if (campo === 'origem') [antes, n] = [c.origem, { ...c, origem: v }]
  else if (campo === 'destino') [antes, n] = [c.destino, { ...c, destino: v }]
  else {
    const i = c.ids.indexOf(campo.parada)
    if (i < 0) return c
    ;[antes, n] = [c.paradas[i]!, { ...c, paradas: c.paradas.map((p, j) => (j === i ? v : p)) }]
  }
  // Só o campo que acabou de ganhar um ponto leva à escolha da categoria: uma resposta tardia de um campo que já tinha
  // ponto não reabre a escolha depois de o cliente voltar aos endereços.
  return !temPonto(antes) && temPonto(v) && completo(n) ? { ...n, escolhendo: true } : n
}

/** Um campo de parada vazio no fim (até `MAX_PARADAS`), com a identidade `id`; volta aos endereços. */
export function comParadaNova(c: CamposDoPedido, id: number): CamposDoPedido {
  if (c.paradas.length >= MAX_PARADAS) return c
  return { ...c, paradas: [...c.paradas, VAZIO], ids: [...c.ids, id], escolhendo: false }
}

/** Sem a parada de índice `i`. */
export function semParada(c: CamposDoPedido, i: number): CamposDoPedido {
  return { ...c, paradas: c.paradas.filter((_, j) => j !== i), ids: c.ids.filter((_, j) => j !== i) }
}
