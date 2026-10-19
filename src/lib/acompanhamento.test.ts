import { describe, expect, it } from 'vitest'
import { chegadaPrevista, posicaoGravada } from './acompanhamento.ts'

describe('posicaoGravada', () => {
  it('usa a hora em que foi gravada e perde para qualquer transmissão (seq -1)', () => {
    const p = posicaoGravada({ lat: -26.9, lng: -48.65, em: '2026-10-19T12:00:00Z' })
    expect(p).toMatchObject({ lat: -26.9, lng: -48.65, seq: -1, recebidaEm: Date.parse('2026-10-19T12:00:00Z') })
  })
  it('descarta o que não confere', () => {
    expect(posicaoGravada(null)).toBeNull()
    expect(posicaoGravada(undefined)).toBeNull()
    expect(posicaoGravada({ lat: 91, lng: 0, em: '2026-10-19T12:00:00Z' })).toBeNull()
    expect(posicaoGravada({ lat: 0, lng: 0, em: 'ontem' })).toBeNull()
  })
})

describe('chegadaPrevista', () => {
  it('prefere a do motorista', () => {
    expect(chegadaPrevista('2026-10-19T12:30:00Z', '2026-10-19T12:00:00Z', 55)).toBe('2026-10-19T12:30:00Z')
  })
  it('sem ela, a saída mais o tempo da rota', () => {
    expect(chegadaPrevista(null, '2026-10-19T12:00:00Z', 55)).toBe('2026-10-19T12:55:00.000Z')
  })
  it('sem nenhuma das duas, nada', () => {
    expect(chegadaPrevista(null, null, 55)).toBeNull()
    expect(chegadaPrevista(null, '2026-10-19T12:00:00Z', null)).toBeNull()
  })
})
