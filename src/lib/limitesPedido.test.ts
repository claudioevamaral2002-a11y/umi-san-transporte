import { describe, expect, it } from 'vitest'
import { PESSOAS_MAX, limitarPessoas } from './limitesPedido.ts'

describe('limitarPessoas (v2.2)', () => {
  it('dentro do limite: não mexe', () => {
    expect(limitarPessoas(4, 4)).toEqual({ qtd: 4, ajustou: false })
    expect(limitarPessoas(1, 4)).toEqual({ qtd: 1, ajustou: false })
  })
  it('troca para uma categoria menor: desce até o limite e avisa', () => {
    expect(limitarPessoas(6, 4)).toEqual({ qtd: 4, ajustou: true })
  })
  it('sem limite (null ou ausente): vale o teto de 99', () => {
    expect(limitarPessoas(6, null)).toEqual({ qtd: 6, ajustou: false })
    expect(limitarPessoas(99, undefined)).toEqual({ qtd: 99, ajustou: false })
    expect(limitarPessoas(120, null)).toEqual({ qtd: PESSOAS_MAX, ajustou: true })
  })
})
