import { describe, expect, it } from 'vitest'
import { podeRecarregarSozinho } from './atualizacao.ts'

describe('podeRecarregarSozinho', () => {
  it('só nas telas de entrada', () => {
    for (const r of ['/', '/entrar', '/definir-senha', '/seguranca/2fa']) expect(podeRecarregarSozinho(r)).toBe(true)
    for (const r of ['/parametros', '/adm/usuarios', '/adm/empresas']) expect(podeRecarregarSozinho(r)).toBe(false)
  })
})
