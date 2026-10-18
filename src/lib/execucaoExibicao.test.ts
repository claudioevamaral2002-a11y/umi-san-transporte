import { describe, expect, it } from 'vitest'
import { formatarKm, linkGoogleMaps, linkWaze, minutosDeViagem, opcoesDePrevisao } from './execucaoExibicao.ts'

describe('execução: exibição', () => {
  it('Maps pelo place_id (com o nome) ou pelas coordenadas do ponto marcado', () => {
    expect(linkGoogleMaps({ nome: 'Porto de Itajaí', lat: null, lng: null, place_id: 'ChIJabc' })).toBe(
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=Porto+de+Itaja%C3%AD&destination_place_id=ChIJabc',
    )
    expect(linkGoogleMaps({ nome: 'Rampa 2', lat: -26.9, lng: -48.66, place_id: null })).toBe(
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=-26.9%2C-48.66',
    )
  })

  it('Waze por coordenadas ou por nome', () => {
    expect(linkWaze({ nome: 'Rampa 2', lat: -26.9, lng: -48.66, place_id: null })).toBe(
      'https://waze.com/ul?ll=-26.9,-48.66&navigate=yes',
    )
    expect(linkWaze({ nome: 'Base & Cia', lat: null, lng: null, place_id: 'x' })).toBe(
      'https://waze.com/ul?q=Base%20%26%20Cia&navigate=yes',
    )
  })

  it('nova previsão: 8 horários de 15 em 15 min, começando ao menos 5 min à frente', () => {
    const agora = Date.parse('2026-10-18T13:52:00Z')
    const o = opcoesDePrevisao(agora)
    expect(o).toHaveLength(8)
    expect(o[0]).toBe('2026-10-18T14:00:00.000Z')
    expect(o[7]).toBe('2026-10-18T15:45:00.000Z')
    expect(opcoesDePrevisao(Date.parse('2026-10-18T13:56:00Z'))[0]).toBe('2026-10-18T14:15:00.000Z')
  })

  it('duração da viagem e km', () => {
    expect(minutosDeViagem('2026-10-18T11:52:00Z', '2026-10-18T14:43:00Z', 0)).toBe(171)
    expect(minutosDeViagem('2026-10-18T11:52:00Z', null, Date.parse('2026-10-18T12:02:00Z'))).toBe(10)
    expect(minutosDeViagem(null, null, 0)).toBeNull()
    expect(formatarKm(41.4)).toBe('~41 km')
    expect(formatarKm(0.3)).toBe('~0,3 km')
    expect(formatarKm(null)).toBeNull()
  })
})
