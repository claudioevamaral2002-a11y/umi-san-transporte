// Fase 4.1: paradas do pedido (até 3, entre a origem e o destino). Pelos termos do Google, de um ponto escolhido na
// busca guarda-se só o `place_id`; de um ponto marcado no mapa, as coordenadas; texto livre vai sem ponto.
// O banco confere tudo de novo (`interno.paradas_validas`); isto só guia a tela e monta o corpo de `criar_pedido`.
import type { Local } from './enderecos.ts'

export const MAX_PARADAS = 3
export const PARADA_TEXTO_MIN = 3
export const PARADA_TEXTO_MAX = 200

export type Parada = { texto: string; place_id?: string } | { texto: string; lat: number; lng: number }

/** A lista cabe mais uma parada? (A tela esconde o "+ Adicionar parada" quando não.) */
export function podeAdicionar(lista: readonly Parada[]): boolean {
  return lista.length < MAX_PARADAS
}

/** Acrescenta no fim. Passando de 3, devolve a mesma lista, sem alterar. */
export function adicionar(lista: readonly Parada[], parada: Parada): Parada[] {
  return podeAdicionar(lista) ? [...lista, parada] : [...lista]
}

/** Tira a parada de índice `i`; índice fora da lista não altera. */
export function remover(lista: readonly Parada[], i: number): Parada[] {
  if (!Number.isInteger(i) || i < 0 || i >= lista.length) return [...lista]
  return lista.filter((_, j) => j !== i)
}

/** A parada com o ponto escolhido: do Google só o `place_id`; marcado no mapa só lat/lng; sem ponto, só o texto. */
export function paradaDoLocal(texto: string, local: (Pick<Local, 'lat' | 'lng' | 'place_id'> & Partial<Local>) | null): Parada {
  if (local?.place_id) return { texto, place_id: local.place_id }
  if (local && local.lat !== null && local.lng !== null) return { texto, lat: local.lat, lng: local.lng }
  return { texto }
}

/** Lista no formato de `criar_pedido` (`paradas`): texto aparado e nunca `place_id` junto de coordenadas. */
export function paraPedido(lista: readonly Parada[]): Parada[] {
  return lista.map((p): Parada => {
    const texto = p.texto.trim()
    if ('place_id' in p && p.place_id) return { texto, place_id: p.place_id }
    if ('lat' in p && 'lng' in p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) return { texto, lat: p.lat, lng: p.lng }
    return { texto }
  })
}

export const MSG_PARADAS_DEMAIS = `Use no máximo ${MAX_PARADAS} paradas.`
export const MSG_PARADA_TEXTO = `Cada parada precisa de ${PARADA_TEXTO_MIN} a ${PARADA_TEXTO_MAX} caracteres.`

/** Mensagem do primeiro problema da lista, ou `null` se está certa. */
export function mensagemDeParadas(lista: readonly Parada[]): string | null {
  if (lista.length > MAX_PARADAS) return MSG_PARADAS_DEMAIS
  for (const p of lista) {
    const n = p.texto.trim().length
    if (n < PARADA_TEXTO_MIN || n > PARADA_TEXTO_MAX) return MSG_PARADA_TEXTO
  }
  return null
}
