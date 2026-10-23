import { describe, expect, it, vi } from 'vitest'

vi.mock('./enderecosRemoto.ts', () => ({ consultarRota: vi.fn() }))

import { consultarRota } from './enderecosRemoto.ts'
import { decodificarPolyline, rotaAte } from './rotaDesenhada.ts'

describe('decodificarPolyline', () => {
  it('decodifica o exemplo da documentação do Google', () => {
    expect(decodificarPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ])
  })

  it('texto vazio dá lista vazia', () => {
    expect(decodificarPolyline('')).toEqual([])
  })
})

describe('rotaAte', () => {
  const o = { lat: -26.9, lng: -48.66 }
  const d = { place_id: 'ChIJabc' }

  it('repassa as paradas ao consultarRota', async () => {
    vi.mocked(consultarRota).mockResolvedValueOnce({ km: 48.2, minutos: 50, polyline: null })
    const paradas = [{ place_id: 'ChIJxyz' }]
    const r = await rotaAte(o, d, paradas)
    expect(consultarRota).toHaveBeenLastCalledWith(o, d, paradas)
    expect(r).toEqual({ km: 48.2, minutos: 50, pontos: [] })
  })

  it('devolve km, minutos e os pontos decodificados', async () => {
    vi.mocked(consultarRota).mockResolvedValueOnce({ km: 38.2, minutos: 45, polyline: '_p~iF~ps|U_ulLnnqC' })
    const r = await rotaAte(o, d)
    expect(consultarRota).toHaveBeenCalledWith(o, d)
    expect(r).toEqual({ km: 38.2, minutos: 45, pontos: [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }] })
  })

  it('sem linha mantém km e tempo, com pontos vazios', async () => {
    vi.mocked(consultarRota).mockResolvedValueOnce({ km: 3, minutos: 5, polyline: null })
    expect(await rotaAte(o, d)).toEqual({ km: 3, minutos: 5, pontos: [] })
  })

  it('sem km ou com falha da chamada devolve null', async () => {
    vi.mocked(consultarRota).mockResolvedValueOnce({ km: null, minutos: null, polyline: null })
    expect(await rotaAte(o, d)).toBeNull()
    vi.mocked(consultarRota).mockResolvedValueOnce(null)
    expect(await rotaAte(o, d)).toBeNull()
  })
})
