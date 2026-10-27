// v2.2: a regra única de "o endereço tem ponto na rota", sem nenhuma importação: os testes unitários que a usam
// (início do cliente, "Pedir de novo") rodam no CI sem as variáveis do Supabase.

export type Coordenada = { lat: number; lng: number }

/** Ponto da rota: do Google pelo place_id; marcado no mapa pelas coordenadas. */
export type PontoRota = { place_id: string } | Coordenada

/** Ponto da rota: do Google pelo place_id; marcado no mapa pelas coordenadas. */
export function pontoDaRota(l: { lat: number | null; lng: number | null; place_id: string | null }): PontoRota | null {
  if (l.place_id) return { place_id: l.place_id }
  return l.lat !== null && l.lng !== null ? { lat: l.lat, lng: l.lng } : null
}

/** Dá para traçar a rota até este local (place_id do Google ou coordenadas de um ponto marcado no mapa). */
export const temPontoNaRota = (l: { lat: number | null; lng: number | null; place_id: string | null } | null | undefined): boolean =>
  !!l && pontoDaRota(l) !== null
