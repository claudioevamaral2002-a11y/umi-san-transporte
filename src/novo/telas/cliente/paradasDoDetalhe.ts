// Fase 4.1: paradas e horas estimadas que `api.pedido` devolve (chaves novas, opcionais: pedidos antigos não têm).
import { pontoDaRota, type PontoRota } from '../../../lib/enderecosRemoto.ts'
import type { DetalhePedido } from '../../../lib/pedidos.ts'

type ParadaDoDetalhe = { texto: string; place_id?: string | null; lat?: number | null; lng?: number | null }
type DetalheComParadas = DetalhePedido & { paradas?: ParadaDoDetalhe[] | null; horas_estimadas?: number | string | null }

/**
 * Paradas do pedido (textos e pontos para a rota) e as horas estimadas. Parada só com texto (sem ponto) fica fora de
 * `pontos`, cada uma por si (como `pontosDasParadas` do motorista): as outras continuam na rota.
 */
export function paradasDoDetalhe(p: DetalhePedido): {
  textos: string[]
  pontos: PontoRota[]
  quantidade: number
  horas: number | null
} {
  const d = p as DetalheComParadas
  const lista = Array.isArray(d.paradas) ? d.paradas.filter((x) => x && typeof x.texto === 'string') : []
  const pontos = lista.flatMap((x) => {
    const pt = pontoDaRota({ lat: x.lat ?? null, lng: x.lng ?? null, place_id: x.place_id ?? null })
    return pt ? [pt] : []
  })
  const h = d.horas_estimadas === null || d.horas_estimadas === undefined ? null : Number(d.horas_estimadas)
  return {
    textos: lista.map((x) => x.texto),
    pontos,
    quantidade: lista.length,
    horas: h !== null && Number.isFinite(h) ? h : null,
  }
}
