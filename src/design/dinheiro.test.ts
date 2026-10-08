import { describe, expect, it } from 'vitest'
import { formatarCentavos } from './dinheiro.ts'

// Intl usa espaço não separável entre "R$" e o número.
const normal = (s: string) => s.replace(/\u00a0/g, ' ')

describe('formatarCentavos', () => {
  it('formata centavos em reais pt-BR', () => {
    expect(normal(formatarCentavos(0))).toBe('R$ 0,00')
    expect(normal(formatarCentavos(123456))).toBe('R$ 1.234,56')
    expect(normal(formatarCentavos(-5))).toBe('-R$ 0,05')
  })

  it('recusa valor que não é inteiro em centavos', () => {
    expect(() => formatarCentavos(1.5)).toThrow(TypeError)
    expect(() => formatarCentavos(Number.NaN)).toThrow(TypeError)
  })
})
