import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAVE_CATEGORIA, CHAVE_CENTRO_CUSTO, gravarUltimaCategoria, gravarUltimoCentroCusto, limparUltimoCentroCusto, lerUltimaCategoria, lerUltimoCentroCusto } from './preferencias.ts'

function armazenamento() {
  const dados = new Map<string, string>()
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    removeItem: (k: string) => void dados.delete(k),
    dados,
  }
}

describe('preferências do aparelho', () => {
  let ls: ReturnType<typeof armazenamento>
  beforeEach(() => {
    ls = armazenamento()
    vi.stubGlobal('localStorage', ls)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('limparUltimoCentroCusto apaga só o centro de custo (a categoria fica)', () => {
    gravarUltimoCentroCusto('  Obra 12  ')
    gravarUltimaCategoria('PASSAGEIROS')
    expect(lerUltimoCentroCusto()).toBe('Obra 12')
    limparUltimoCentroCusto()
    expect(lerUltimoCentroCusto()).toBe('')
    expect(ls.dados.has(CHAVE_CENTRO_CUSTO)).toBe(false)
    expect(ls.dados.get(CHAVE_CATEGORIA)).toBe('PASSAGEIROS')
    expect(lerUltimaCategoria()).toBe('PASSAGEIROS')
  })

  it('armazenamento bloqueado não quebra a limpeza', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bloqueado')
      },
      removeItem: () => {
        throw new Error('bloqueado')
      },
    })
    expect(() => limparUltimoCentroCusto()).not.toThrow()
    expect(lerUltimoCentroCusto()).toBe('')
  })
})
