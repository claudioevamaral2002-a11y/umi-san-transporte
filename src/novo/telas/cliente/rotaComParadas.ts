// Fase 4.1: rota do pedido com paradas (origem → paradas → destino) e os km que vão para a prévia de preço.
import type { PontoRota } from '../../../lib/enderecosRemoto.ts'
import { useRota } from '../../useRota.ts'
import { kmsDaPrevia } from './kmsDaPrevia.ts'

/**
 * A ida inteira numa chamada (as paradas vão como pontos intermediários) e, em ida e volta, a volta direta
 * (destino → origem, sem paradas) numa segunda chamada (especificação §5). Para `categorias.disponiveis`
 * (`kmsDaPrevia`):
 * - `km`: a ida pelas paradas; `null` enquanto carrega ou sem rota;
 * - `kmVolta`: a volta direta; `null` em trecho único ou se a volta falhou (aí o banco dobra a ida, como antes da
 *   4.1). Enquanto a volta carrega, `km` também fica `null`, para o preço não sair duas vezes.
 */
export function useRotaComParadas(
  origem: PontoRota | null,
  destino: PontoRota | null,
  paradas: readonly PontoRota[],
  idaEVolta: boolean,
) {
  const ida = useRota(origem, destino, paradas)
  const volta = useRota(idaEVolta ? destino : null, idaEVolta ? origem : null)
  const esperandoVolta = idaEVolta && volta.estado.fase === 'carregando'
  const kms =
    ida.estado.fase === 'pronta' && !esperandoVolta
      ? kmsDaPrevia(ida.estado.rota.km, idaEVolta && volta.estado.fase === 'pronta' ? volta.estado.rota.km : null)
      : null
  return { estado: ida.estado, km: kms?.km ?? null, kmVolta: kms?.kmVolta ?? null, tentarDeNovo: ida.tentarDeNovo }
}
