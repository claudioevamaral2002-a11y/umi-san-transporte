// Fase 4.1: rota do pedido com paradas (origem → paradas → destino) e os km que vão para a prévia de preço.
import { useCallback } from 'react'
import type { PontoRota } from '../../../lib/enderecosRemoto.ts'
import { useRota } from '../../useRota.ts'
import { kmsDaPrevia } from './kmsDaPrevia.ts'

/**
 * A ida inteira numa chamada (as paradas vão como pontos intermediários) e, em ida e volta **com paradas**, a volta
 * direta (destino → origem, sem paradas) numa segunda chamada (especificação §5). Igual à calculadora do motorista:
 * sem paradas não há segunda chamada e o banco dobra a ida. Para `categorias.disponiveis` (`kmsDaPrevia`):
 * - `km`: a ida pelas paradas; `null` enquanto carrega ou sem rota;
 * - `kmVolta`: a volta direta; `null` sem volta (trecho único, sem paradas ou a volta falhou: o banco dobra a ida).
 *   Enquanto a volta carrega, `km` também fica `null`, para o preço não sair duas vezes.
 */
export function useRotaComParadas(
  origem: PontoRota | null,
  destino: PontoRota | null,
  paradas: readonly PontoRota[],
  idaEVolta: boolean,
) {
  const comVolta = idaEVolta && paradas.length > 0
  const ida = useRota(origem, destino, paradas)
  const volta = useRota(comVolta ? destino : null, comVolta ? origem : null)
  const esperandoVolta = comVolta && volta.estado.fase === 'carregando'
  const kms =
    ida.estado.fase === 'pronta' && !esperandoVolta
      ? kmsDaPrevia(ida.estado.rota.km, comVolta && volta.estado.fase === 'pronta' ? volta.estado.rota.km : null)
      : null
  const tentarIda = ida.tentarDeNovo
  const tentarVolta = volta.tentarDeNovo
  const faseVolta = volta.estado.fase
  // "Tentar de novo" refaz também a volta que falhou (a ida que deu certo fica na memória da aba).
  const tentarDeNovo = useCallback(() => {
    tentarIda()
    if (faseVolta === 'falhou') tentarVolta()
  }, [tentarIda, tentarVolta, faseVolta])
  return { estado: ida.estado, km: kms?.km ?? null, kmVolta: kms?.kmVolta ?? null, tentarDeNovo }
}
