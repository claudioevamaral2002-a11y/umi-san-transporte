import { describe, expect, it, vi } from 'vitest'
import type { DetalhePedido } from '../../../lib/pedidos.ts'
import { paradasDoDetalhe } from './paradasDoDetalhe.ts'

// enderecosRemoto.ts importa o cliente do Supabase; no CI não há VITE_SUPABASE_URL para os testes de unidade.
vi.mock('../../../lib/supabase.ts', () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } } }))

const detalhe = (extra: Record<string, unknown>) => ({ id: 'p1', ...extra }) as unknown as DetalhePedido

describe('paradasDoDetalhe', () => {
  it('pedido antigo (sem paradas nem horas): tudo vazio', () => {
    expect(paradasDoDetalhe(detalhe({}))).toEqual({ textos: [], pontos: [], quantidade: 0, horas: null })
  })

  it('cada parada com ponto vira um ponto da rota (place_id antes das coordenadas)', () => {
    const r = paradasDoDetalhe(
      detalhe({
        paradas: [
          { texto: 'Centro', place_id: 'abc', lat: 1, lng: 2 },
          { texto: 'Marcado no mapa', lat: -26.91, lng: -48.66 },
        ],
        horas_estimadas: '2.5',
      }),
    )
    expect(r.pontos).toEqual([{ place_id: 'abc' }, { lat: -26.91, lng: -48.66 }])
    expect(r.quantidade).toBe(2)
    expect(r.horas).toBe(2.5)
  })

  it('parada só com texto fica fora da rota, sem derrubar as outras', () => {
    const r = paradasDoDetalhe(
      detalhe({
        paradas: [
          { texto: 'Centro', place_id: 'abc' },
          { texto: 'Só texto', place_id: null, lat: null, lng: null },
          { texto: 'Marcado no mapa', lat: -26.91, lng: -48.66 },
        ],
      }),
    )
    expect(r.pontos).toEqual([{ place_id: 'abc' }, { lat: -26.91, lng: -48.66 }])
    expect(r.textos).toEqual(['Centro', 'Só texto', 'Marcado no mapa'])
    expect(r.quantidade).toBe(3)
  })
})
