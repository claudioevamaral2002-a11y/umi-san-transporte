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
    expect(r).toMatchObject({ categoria: 'CARGA_LEVE', idaEVolta: true })
  })
  it('sem ponto que dê rota, não oferece', () => {
    expect(pedirDeNovoDe(pedido({ origem_place_id: null }))).toBeNull()
  })
})

describe('lerPedirDeNovo', () => {
  it('ida e volta do estado da navegação', () => {
    const r = pedirDeNovoDe(pedido())!
    expect(lerPedirDeNovo({ pedirDeNovo: JSON.parse(JSON.stringify(r)) })).toEqual(r)
  })
  it('estado estranho vira nulo', () => {
    expect(lerPedirDeNovo(null)).toBeNull()
    expect(lerPedirDeNovo({ pedirDeNovo: { origem: 1 } })).toBeNull()
  })
})
