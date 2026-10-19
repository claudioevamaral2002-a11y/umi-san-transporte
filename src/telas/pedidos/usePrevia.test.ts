import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase.ts', () => ({ supabase: { rpc: vi.fn() } }))

const { etiquetaDaPrevia, previaDaChave } = await import('./usePrevia.ts')

const ok = { estado: 'ok' as const, linhas: [], total: 18000 }

describe('prévia etiquetada pela entrada', () => {
  it('sem entrada: nada', () => {
    expect(previaDaChave({ chave: 'x', previa: ok }, null)).toBeNull()
  })
  it('a prévia da mesma entrada vale', () => {
    const e = etiquetaDaPrevia('p1', { km: 42 })
    expect(previaDaChave({ chave: e!, previa: ok }, e)).toBe(ok)
  })
  it('entrada mudou (debounce): calculando, nunca o total antigo', () => {
    const antiga = etiquetaDaPrevia('p1', { km: 42 })!
    expect(previaDaChave({ chave: antiga, previa: ok }, etiquetaDaPrevia('p1', { km: 43 }))).toEqual({ estado: 'calculando' })
  })
  it('voltar de inválido para válido com outra entrada: calculando', () => {
    expect(previaDaChave(null, etiquetaDaPrevia('p1', { km: 50 }))).toEqual({ estado: 'calculando' })
  })
  it('mesma entrada de outro pedido: não reaproveita', () => {
    const e1 = etiquetaDaPrevia('p1', { km: 42 })!
    expect(previaDaChave({ chave: e1, previa: ok }, etiquetaDaPrevia('p2', { km: 42 }))).toEqual({ estado: 'calculando' })
  })
})
