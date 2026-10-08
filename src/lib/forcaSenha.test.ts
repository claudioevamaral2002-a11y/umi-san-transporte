import { describe, expect, it } from 'vitest'
import { avaliarSenha, normalizarSenha } from './forcaSenha.ts'

describe('avaliarSenha (mesmas regras do servidor)', () => {
  it.each([
    ['Abcdefgh1j', true],
    ['Senha-Forte-2026', true],
    ['Abcdefgh1', false],
    ['abcdefghij1', false],
    ['ABCDEFGHIJ1', false],
    ['Abcdefghijk', false],
    ['Aa1' + 'x'.repeat(69), true],
    ['Aa1' + 'x'.repeat(70), false],
    ['Aa1' + 'é'.repeat(35), false],
    ['', false],
    ['Ágilidade2026x', false],
    ['ágilidade2026X', true],
  ])('%s -> %s', (senha, valida) => {
    expect(avaliarSenha(senha).valida).toBe(valida)
  })

  it('nível conta as regras atendidas e marca senha longa', () => {
    expect(avaliarSenha('').nivel).toBe(0)
    expect(avaliarSenha('abc').nivel).toBe(1)
    expect(avaliarSenha('Abcdefgh1j').nivel).toBe(4)
    expect(avaliarSenha('Aa1' + 'é'.repeat(35)).longaDemais).toBe(true)
  })

  it('normaliza em NFC (igual ao servidor)', () => {
    expect(normalizarSenha('Café-Forte-1')).toBe('Café-Forte-1')
  })
})
