import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const { contato, formatarTelefone, mascararTelefoneDoPerfil, normalizarTelefone } = await import('./perfilContato.ts')

beforeEach(() => rpc.mockReset())

describe('normalizarTelefone (a mesma regra do banco)', () => {
  it('celular e fixo com DDD viram só dígitos', () => {
    expect(normalizarTelefone('(47) 99999-1234')).toEqual({ ok: true, digitos: '47999991234' })
    expect(normalizarTelefone(' 47 3344-5566 ')).toEqual({ ok: true, digitos: '4733445566' })
    expect(normalizarTelefone('+55 47 98888.7777')).toEqual({ ok: true, digitos: '47988887777' })
  })
  it('vazio apaga', () => {
    expect(normalizarTelefone('')).toEqual({ ok: true, digitos: null })
    expect(normalizarTelefone('   ')).toEqual({ ok: true, digitos: null })
  })
  it('recusa curto, longo, DDD com zero, letras e celular sem o 9', () => {
    for (const t of ['4799999', '479999912345', '(07) 99999-1234', '47 9999a-1234', '47 8999-91234', '4'.repeat(40)]) {
      expect(normalizarTelefone(t), t).toEqual({ ok: false })
    }
  })
})

describe('mascararTelefoneDoPerfil', () => {
  it('tira o +55 (ou 55 com 12–13 dígitos) antes da máscara: o DDD nunca vira 55', () => {
    expect(mascararTelefoneDoPerfil('+55 91 98888-7777')).toBe('(91) 98888-7777')
    expect(mascararTelefoneDoPerfil('5591988887777')).toBe('(91) 98888-7777')
    expect(mascararTelefoneDoPerfil('+55 47 3344-5566')).toBe('(47) 3344-5566')
    expect(mascararTelefoneDoPerfil('554733445566')).toBe('(47) 3344-5566')
  })
  it('sem código do país, igual à máscara de hoje (também o DDD 55 de verdade)', () => {
    expect(mascararTelefoneDoPerfil('(47) 99999-1234')).toBe('(47) 99999-1234')
    expect(mascararTelefoneDoPerfil('55999991234')).toBe('(55) 99999-1234')
    expect(mascararTelefoneDoPerfil('479')).toBe('(47) 9')
    expect(mascararTelefoneDoPerfil('')).toBe('')
  })
})

describe('formatarTelefone', () => {
  it('mostra com máscara; texto antigo fora do padrão fica como está', () => {
    expect(formatarTelefone('47999991234')).toBe('(47) 99999-1234')
    expect(formatarTelefone('4733445566')).toBe('(47) 3344-5566')
    expect(formatarTelefone(null)).toBe('')
    expect(formatarTelefone('(48) 3333-0000')).toBe('(48) 3333-0000')
  })
})

describe('contato', () => {
  it('lê e grava o telefone só com os dígitos (vazio vai nulo)', async () => {
    rpc.mockResolvedValue({ data: { ok: true, telefone: '47999991234' }, error: null })
    expect(await contato.meuTelefone()).toBe('47999991234')
    expect(rpc).toHaveBeenCalledWith('meu_telefone', {})
    await contato.salvarTelefone('47999991234')
    expect(rpc).toHaveBeenLastCalledWith('salvar_meu_telefone', { p_telefone: '47999991234' })
    await contato.salvarTelefone(null)
    expect(rpc).toHaveBeenLastCalledWith('salvar_meu_telefone', { p_telefone: null })
  })
})
