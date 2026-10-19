import { chamarFuncao } from './funcoes.ts'

/**
 * Fase 4: a linha do trajeto para desenhar no mapa. O Google devolve a rota como texto codificado; ela é decodificada
 * aqui, usada na tela e descartada: nunca vai para o banco (termos do Google).
 */

export type Coordenada = { lat: number; lng: number }

/** Ponto da rota: do Google pelo place_id; marcado no mapa pelas coordenadas. */
export type PontoRota = { place_id: string } | Coordenada

/** Algoritmo padrão de "encoded polyline" do Google, precisão 1e5. Texto truncado ou inválido para no último ponto inteiro. */
export function decodificarPolyline(codificada: string): Coordenada[] {
  const pontos: Coordenada[] = []
  let i = 0
  let lat = 0
  let lng = 0
  const proximo = (): number | null => {
    let resultado = 0
    let deslocamento = 0
    let byte: number
    do {
      if (i >= codificada.length) return null
      byte = codificada.charCodeAt(i++) - 63
      resultado += (byte & 0x1f) * 2 ** deslocamento
      deslocamento += 5
    } while (byte >= 0x20)
    return resultado % 2 === 1 ? -(resultado + 1) / 2 : resultado / 2
  }
  while (i < codificada.length) {
    const dLat = proximo()
    const dLng = proximo()
    if (dLat === null || dLng === null) break
    lat += dLat
    lng += dLng
    pontos.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return pontos
}

/** Distância, tempo e linha do trajeto de carro; `null` sem rota, sem linha ou com o Google fora. */
export async function rotaAte(
  origem: PontoRota,
  destino: PontoRota,
): Promise<{ km: number; minutos: number | null; pontos: Coordenada[] } | null> {
  const r = await chamarFuncao('enderecos', { acao: 'rota', origem, destino })
  if (!r.ok || typeof r.km !== 'number' || typeof r.polyline !== 'string') return null
  const pontos = decodificarPolyline(r.polyline)
  if (pontos.length === 0) return null
  return { km: r.km, minutos: typeof r.minutos === 'number' ? r.minutos : null, pontos }
}
