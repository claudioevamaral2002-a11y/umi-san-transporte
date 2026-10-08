import { describe, expect, it } from 'vitest'
import { base32Decodificar, gerarTotp, gerarTotpBruto } from './totp.ts'

// RFC 6238, apêndice B: segredo ASCII "12345678901234567890" (SHA-1).
const segredoAscii = Buffer.from('12345678901234567890', 'ascii')
const segredoBase32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('TOTP (RFC 6238, SHA-1)', () => {
  it('vetores do RFC com 8 dígitos', () => {
    const vetores: Array<[number, string]> = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
    ]
    for (const [segundos, esperado] of vetores) {
      expect(gerarTotpBruto(segredoAscii, { agora: segundos * 1000, digitos: 8 })).toBe(esperado)
    }
  })

  it('6 dígitos são os 6 últimos do vetor de 8', () => {
    expect(gerarTotpBruto(segredoAscii, { agora: 59_000 })).toBe('287082')
  })

  it('segredo em base32 equivale ao segredo em bytes', () => {
    expect(base32Decodificar(segredoBase32).equals(segredoAscii)).toBe(true)
    expect(gerarTotp(segredoBase32, { agora: 59_000 })).toBe('287082')
    expect(gerarTotp(segredoBase32.toLowerCase(), { agora: 59_000 })).toBe('287082')
  })

  it('base32 inválido é recusado', () => {
    expect(() => base32Decodificar('abc1')).toThrow()
  })
})
