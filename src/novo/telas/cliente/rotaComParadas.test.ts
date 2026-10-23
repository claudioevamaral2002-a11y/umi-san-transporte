import { describe, expect, it, vi } from 'vitest'

// rotaComParadas.ts chega ao cliente do Supabase e às Edge Functions (useRota e kmsDaPrevia), que leem
// VITE_SUPABASE_URL ao carregar; no CI não há essa variável para os testes de unidade.
vi.mock('../../useRota.ts', () => ({ useRota: vi.fn() }))
vi.mock('../../../lib/supabase.ts', () => ({ supabase: { rpc: vi.fn() } }))

const { voltaAOrigem } = await import('./rotaComParadas.ts')

// Glória (Joinville): 0,001° de latitude ≈ 111 m.
const GLORIA = { lat: -26.3, lng: -48.85 }

describe('voltaAOrigem', () => {
  it('mesmo place_id: sim', () => {
    expect(voltaAOrigem({ place_id: 'ChIJa' }, { place_id: 'ChIJa' })).toBe(true)
  })
  it('place_id diferente e sem coordenadas: não', () => {
    expect(voltaAOrigem({ place_id: 'ChIJa' }, { place_id: 'ChIJb' })).toBe(false)
  })
  it('a 250 m: sim; a 400 m: não', () => {
    expect(voltaAOrigem(GLORIA, { lat: GLORIA.lat + 0.00225, lng: GLORIA.lng })).toBe(true)
    expect(voltaAOrigem(GLORIA, { lat: GLORIA.lat + 0.0036, lng: GLORIA.lng })).toBe(false)
  })
  it('place_id diferente, mas coordenadas (na memória da tela) a menos de 300 m: sim', () => {
    expect(
      voltaAOrigem({ place_id: 'ChIJa', lat: GLORIA.lat, lng: GLORIA.lng }, { place_id: 'ChIJb', lat: GLORIA.lat, lng: GLORIA.lng + 0.001 }),
    ).toBe(true)
  })
  it('sem um dos pontos ou sem coordenadas: não', () => {
    expect(voltaAOrigem(null, GLORIA)).toBe(false)
    expect(voltaAOrigem(GLORIA, undefined)).toBe(false)
    expect(voltaAOrigem({ place_id: null, lat: null, lng: null }, { place_id: null, lat: null, lng: null })).toBe(false)
    expect(voltaAOrigem({ place_id: 'ChIJa' }, GLORIA)).toBe(false)
  })
})
