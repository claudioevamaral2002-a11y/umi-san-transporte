import { describe, expect, it } from 'vitest'
import { fraseQuando, horariosDoDia } from './horariosDoDia.ts'

const h = (hm: string) => new Date(`2026-10-13T${hm}:00-03:00`).toISOString()

describe('horariosDoDia', () => {
  it('preenche os buracos entre livres como ocupados', () => {
    const r = horariosDoDia([h('07:00'), h('07:30'), h('09:00')])
    expect(r.map((x) => x.livre)).toEqual([true, true, false, false, true])
    expect(r[2]!.inicio).toBe(h('08:00'))
  })
  it('sem livres não inventa ocupados', () => {
    expect(horariosDoDia([])).toEqual([])
  })
  it('ordena entradas fora de ordem', () => {
    const r = horariosDoDia([h('08:00'), h('07:00')])
    expect(r.map((x) => x.livre)).toEqual([true, false, true])
  })
  it('respeita o passo informado', () => {
    expect(horariosDoDia([h('07:00'), h('08:00')], 60).map((x) => x.livre)).toEqual([true, true])
  })
})

describe('fraseQuando', () => {
  it('escreve o dia e a faixa no fuso de São Paulo, sem "-feira"', () => {
    expect(fraseQuando('2026-10-13', h('07:30'), 120)).toBe('Terça, 13 de outubro, das 07:30 às 09:30')
  })
  it('sábado não tem "-feira"', () => {
    expect(fraseQuando('2026-10-17', new Date('2026-10-17T13:00:00-03:00').toISOString(), 90)).toBe(
      'Sábado, 17 de outubro, das 13:00 às 14:30',
    )
  })
})
