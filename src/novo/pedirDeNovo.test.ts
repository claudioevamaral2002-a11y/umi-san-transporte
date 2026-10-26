import { describe, expect, it } from 'vitest'
import type { DetalhePedido } from '../lib/pedidos.ts'
import { lerPedirDeNovo, pedirDeNovoDe } from './pedirDeNovo.ts'

const pedido = (extra: Partial<DetalhePedido> = {}) =>
  ({
    origem: 'Estaleiro',
    destino: 'Porto',
    origem_place_id: 'ChIJa',
    destino_place_id: null,
    destino_lat: -26.9,
    destino_lng: -48.6,
    trazer: true,
    categoria: 'CARGA_LEVE',
    ...extra,
  }) as DetalhePedido

describe('pedirDeNovoDe', () => {
  it('leva só o que o pedido guarda: nome e place_id do Google, ou as coordenadas do ponto marcado', () => {
    const r = pedirDeNovoDe(pedido())!
    expect(r.origem.local).toEqual({ nome: 'Estaleiro', endereco: null, lat: null, lng: null, place_id: 'ChIJa' })
    expect(r.destino.local).toMatchObject({ lat: -26.9, lng: -48.6, place_id: null })
    expect(r).toMatchObject({ categoria: 'CARGA_LEVE', diarias: 0 })
    expect(r).not.toHaveProperty('idaEVolta')
  })
  it('v2.1: traz as diárias do pedido; fora de 0 a 30 vira 0', () => {
    expect(pedirDeNovoDe(pedido({ diarias_estimadas: 3 }))!.diarias).toBe(3)
    expect(pedirDeNovoDe(pedido({ diarias_estimadas: null }))!.diarias).toBe(0)
    expect(pedirDeNovoDe(pedido({ diarias_estimadas: 31 }))!.diarias).toBe(0)
  })
  it('sem ponto que dê rota, não oferece', () => {
    expect(pedirDeNovoDe(pedido({ origem_place_id: null }))).toBeNull()
  })
})

describe('lerPedirDeNovo', () => {
  it('ida e volta do estado da navegação, com as diárias', () => {
    const r = pedirDeNovoDe(pedido({ diarias_estimadas: 2 }))!
    expect(lerPedirDeNovo({ pedirDeNovo: JSON.parse(JSON.stringify(r)) })).toEqual(r)
  })
  it('estado antigo (com idaEVolta, sem diárias) abre como trecho único e sem diárias', () => {
    const r = pedirDeNovoDe(pedido())!
    const antigo = { origem: r.origem, destino: r.destino, categoria: 'CARGA_LEVE', idaEVolta: true }
    expect(lerPedirDeNovo({ pedirDeNovo: antigo })).toEqual({ ...r, diarias: 0 })
    expect(lerPedirDeNovo({ pedirDeNovo: { ...antigo, diarias: 'x' } })!.diarias).toBe(0)
  })
  it('estado estranho vira nulo', () => {
    expect(lerPedirDeNovo(null)).toBeNull()
    expect(lerPedirDeNovo({ pedirDeNovo: { origem: 1 } })).toBeNull()
  })
})
