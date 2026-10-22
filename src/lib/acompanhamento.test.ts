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
  const agora = Date.parse('2026-10-19T12:10:00Z')
  it('a do motorista é real (estimada: false), mesmo que já tenha passado', () => {
    expect(chegadaPrevista('2026-10-19T12:30:00Z', '2026-10-19T12:00:00Z', 55, agora)).toEqual({ iso: '2026-10-19T12:30:00Z', estimada: false })
    expect(chegadaPrevista('2026-10-19T12:05:00Z', null, null, agora)).toEqual({ iso: '2026-10-19T12:05:00Z', estimada: false })
  })
  it('sem ela, saída + tempo da rota, marcada como estimada', () => {
    expect(chegadaPrevista(null, '2026-10-19T12:00:00Z', 55, agora)).toEqual({ iso: '2026-10-19T12:55:00.000Z', estimada: true })
  })
  it('estimativa que já passou vira nada (o motorista está atrasado: não se mostra um horário vencido)', () => {
    expect(chegadaPrevista(null, '2026-10-19T10:00:00Z', 55, agora)).toBeNull()
    expect(chegadaPrevista(null, '2026-10-19T11:15:00Z', 55, agora)).toBeNull()
  })
  it('sem nenhuma das duas, nada', () => {
    expect(chegadaPrevista(null, null, 55, agora)).toBeNull()
    expect(chegadaPrevista(null, '2026-10-19T12:00:00Z', null, agora)).toBeNull()
  })
})
