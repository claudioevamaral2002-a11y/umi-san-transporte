import { describe, expect, it } from 'vitest'
import { diaCurto, iniciais, kmDaRota, prazoAte, quandoCompleto, quandoCurto, reaisCurto } from './formatos.ts'

// 2026-10-21 é uma quarta-feira; 11:30Z = 08:30 em São Paulo.
const QUARTA = '2026-10-21T11:30:00.000Z'

describe('formatos do app novo', () => {
  it('dia e hora curtos em São Paulo', () => {
    expect(diaCurto(QUARTA)).toBe('qua 21/10')
    expect(quandoCompleto(QUARTA)).toBe('qua 21/10, 08:30')
    expect(quandoCurto(QUARTA)).toBe('qua 08:30')
  })

  it('prazo: hoje, amanhã ou o dia', () => {
    const agora = new Date('2026-10-20T11:02:00.000Z')
    expect(prazoAte('2026-10-20T15:02:00.000Z', agora)).toBe('hoje, 12:02')
    expect(prazoAte(QUARTA, agora)).toBe('amanhã, 08:30')
    expect(prazoAte('2026-10-23T11:30:00.000Z', agora)).toBe('sex 23/10, 08:30')
  })

  it('valor inteiro sem casas; com centavos, exato', () => {
    expect(reaisCurto(18000).replace(/\s/g, ' ')).toBe('R$ 180')
    expect(reaisCurto(22050).replace(/\s/g, ' ')).toBe('R$ 220,50')
    expect(reaisCurto(123400).replace(/\s/g, ' ')).toBe('R$ 1.234')
  })

  it('iniciais e km da rota', () => {
    expect(iniciais('Ivo Barbosa')).toBe('IB')
    expect(iniciais('Ivo')).toBe('I')
    expect(kmDaRota(42.37)).toBe(42.4)
  })
})
