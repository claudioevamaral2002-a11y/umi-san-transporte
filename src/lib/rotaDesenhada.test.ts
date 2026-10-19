import { describe, expect, it, vi } from 'vitest'

vi.mock('./funcoes.ts', () => ({ chamarFuncao: vi.fn() }))

import { chamarFuncao } from './funcoes.ts'
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

  it('devolve km, minutos e os pontos decodificados', async () => {
    vi.mocked(chamarFuncao).mockResolvedValueOnce({ ok: true, km: 38.2, minutos: 45, polyline: '_p~iF~ps|U_ulLnnqC' })
    const r = await rotaAte(o, d)
    expect(chamarFuncao).toHaveBeenCalledWith('enderecos', { acao: 'rota', origem: o, destino: d })
    expect(r).toEqual({ km: 38.2, minutos: 45, pontos: [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }] })
  })

  it('sem linha, sem km ou com falha devolve null', async () => {
    vi.mocked(chamarFuncao).mockResolvedValueOnce({ ok: true, km: 3, minutos: 5, polyline: null })
    expect(await rotaAte(o, d)).toBeNull()
    vi.mocked(chamarFuncao).mockResolvedValueOnce({ ok: true, km: null, minutos: null })
    expect(await rotaAte(o, d)).toBeNull()
    vi.mocked(chamarFuncao).mockResolvedValueOnce({ ok: false, codigo: 'INDISPONIVEL' })
    expect(await rotaAte(o, d)).toBeNull()
  })
})
