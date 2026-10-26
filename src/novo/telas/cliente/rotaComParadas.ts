// Fase 4.1: rota do pedido com paradas (origem → paradas → destino) e os km que vão para a prévia de preço.
import { useCallback } from 'react'
import type { PontoRota } from '../../../lib/enderecosRemoto.ts'
import { useRota } from '../../useRota.ts'
import { kmsDaPrevia } from './kmsDaPrevia.ts'

/** Ponto do De ou do Para: do Google (`place_id`, com as coordenadas só na memória da tela) ou marcado no mapa. */
type PontoComparavel = { place_id?: string | null; lat?: number | null; lng?: number | null }

/** Distância máxima (exclusiva) entre o De e o Para para a corrida contar como volta à origem. */
export const RAIO_VOLTA_A_ORIGEM_M = 300

/** Distância em metros entre dois pontos (haversine, raio médio da Terra). */
function distanciaM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

const coordenadas = (p: PontoComparavel) =>
  typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    ? { lat: p.lat, lng: p.lng }
    : null

/**
 * v2.1 (especificação §2): o Para é o mesmo lugar do De, e a corrida é um circuito fechado que não paga o retorno de
 * trecho único. Mesmo `place_id`, ou os dois pontos com coordenadas a menos de 300 m um do outro.
 */
export function voltaAOrigem(de: PontoComparavel | null | undefined, para: PontoComparavel | null | undefined): boolean {
  if (!de || !para) return false
  if (de.place_id && de.place_id === para.place_id) return true
  const a = coordenadas(de)
  const b = coordenadas(para)
  return a !== null && b !== null && distanciaM(a, b) < RAIO_VOLTA_A_ORIGEM_M
}

/**
 * A ida inteira numa chamada (as paradas vão como pontos intermediários) e, em ida e volta **com paradas**, a volta
 * direta (destino → origem, sem paradas) numa segunda chamada (especificação §5). Igual à calculadora do motorista:
 * sem paradas não há segunda chamada e o banco dobra a ida. Para `categorias.disponiveis` (`kmsDaPrevia`):
 * - `km`: a ida pelas paradas; `null` enquanto carrega ou sem rota;
 * - `kmVolta`: a volta direta; `null` sem volta (trecho único ou sem paradas: o banco dobra a ida).
 *   Enquanto a volta carrega, `km` também fica `null`, para o preço não sair duas vezes.
 * - `falhou`: a ida ou, com paradas em ida e volta, a volta falhou. Sem a volta não há preço (`km` nulo): dobrar a ida
 *   pelas paradas daria outro preço que o do motorista. A tela mostra "Tentar de novo" (refaz as duas).
 * `estado` é o da ida (o mapa desenha a ida mesmo quando só a volta falhou).
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
  const voltaFalhou = comVolta && volta.estado.fase === 'falhou'
  const kms =
    ida.estado.fase === 'pronta' && !esperandoVolta && !voltaFalhou
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
  return {
    estado: ida.estado,
    falhou: ida.estado.fase === 'falhou' || voltaFalhou,
    km: kms?.km ?? null,
    kmVolta: kms?.kmVolta ?? null,
    tentarDeNovo,
  }
}
