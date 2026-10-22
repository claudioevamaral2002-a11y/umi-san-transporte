import { describe, expect, it } from 'vitest'
import { kmDoPedido } from '../../../lib/categorias.ts'
import { kmsDaPrevia } from './kmsDaPrevia.ts'

describe('kmsDaPrevia', () => {
  it('trecho único: só a ida, com uma casa', () => {
    expect(kmsDaPrevia(48.24, null)).toEqual({ km: 48.2, kmVolta: null })
  })
  it('ida e volta: km + km_volta é o total do motorista (kmDoPedido), arredondado uma vez só', () => {
    const r = kmsDaPrevia(30.04, 21.04)
    expect(r).toEqual({ km: 30, kmVolta: 21.1 })
    const total = kmDoPedido({ ida: { km: 30.04 }, volta: { km: 21.04 }, levar: true, trazer: true })
    expect(total).toBe(51.1)
    expect(Math.round((r.km + r.kmVolta!) * 10) / 10).toBe(total)
  })
  it('as duas pernas com no máximo uma casa', () => {
    for (const [ida, volta] of [
      [12.35, 7.45],
      [0.04, 0.04],
      [99.99, 0.01],
    ] as const) {
      const r = kmsDaPrevia(ida, volta)
      expect(String(r.km)).toMatch(/^\d+(\.\d)?$/)
      expect(String(r.kmVolta)).toMatch(/^\d+(\.\d)?$/)
      expect(Math.round((r.km + r.kmVolta!) * 10) / 10).toBe(kmDoPedido({ ida: { km: ida }, volta: { km: volta }, levar: true, trazer: true }))
    }
  })
})
