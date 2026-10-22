// "Pedir de novo" (Tarefa 9): a corrida concluída leva a mesma origem, destino, categoria e ida e volta para a escolha de
// categoria, sem data. Vai pelo estado da navegação, só com o que o pedido já guarda (nome e place_id do Google, ou as
// coordenadas de um ponto marcado no mapa): nenhum endereço do Google é guardado a mais.
import type { Local } from '../lib/enderecos.ts'
import type { DetalhePedido } from '../lib/pedidos.ts'

/** Dá para traçar a rota: place_id do Google, ou coordenadas de um ponto marcado no mapa (mesma regra de `pontoDaRota`). */
const temPonto = (l: Pick<Local, 'lat' | 'lng' | 'place_id'>) => !!l.place_id || (l.lat !== null && l.lng !== null)

export interface PedirDeNovo {
  origem: { texto: string; local: Local }
  destino: { texto: string; local: Local }
  categoria: string | null
  idaEVolta: boolean
}

const local = (p: DetalhePedido, lado: 'origem' | 'destino'): Local => ({
  nome: p[lado],
  endereco: null,
  lat: p[`${lado}_lat`] ?? null,
  lng: p[`${lado}_lng`] ?? null,
  place_id: p[`${lado}_place_id`] ?? null,
})

/** O pedido concluído como ponto de partida de um novo; `null` se faltar um ponto que dê para traçar a rota. */
export function pedirDeNovoDe(p: DetalhePedido): PedirDeNovo | null {
  const origem = local(p, 'origem')
  const destino = local(p, 'destino')
  if (!temPonto(origem) || !temPonto(destino)) return null
  return {
    origem: { texto: p.origem, local: origem },
    destino: { texto: p.destino, local: destino },
    categoria: p.categoria ?? null,
    idaEVolta: p.trazer,
  }
}

const ehLocal = (v: unknown): v is Local => {
  if (!v || typeof v !== 'object') return false
  const l = v as Record<string, unknown>
  return typeof l.nome === 'string' && (l.lat === null || typeof l.lat === 'number') && (l.lng === null || typeof l.lng === 'number')
}

/** Lê o estado da navegação (dado do navegador: confere o formato antes de usar). */
export function lerPedirDeNovo(estado: unknown): PedirDeNovo | null {
  const e = (estado as { pedirDeNovo?: Record<string, unknown> } | null)?.pedirDeNovo
  if (!e) return null
  const par = (v: unknown) => {
    const x = v as { texto?: unknown; local?: unknown } | null
    return x && typeof x.texto === 'string' && ehLocal(x.local) ? { texto: x.texto, local: x.local } : null
  }
  const origem = par(e.origem)
  const destino = par(e.destino)
  if (!origem || !destino || !temPonto(origem.local) || !temPonto(destino.local)) return null
  return {
    origem,
    destino,
    categoria: typeof e.categoria === 'string' ? e.categoria : null,
    idaEVolta: e.idaEVolta === true,
  }
}
