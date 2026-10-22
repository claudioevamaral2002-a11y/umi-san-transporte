import type { CodigoCategoria } from './categorias.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const { FORM_VEICULO_VAZIO, normalizarPlaca, validarVeiculo, veiculos } = await import('./veiculos.ts')

beforeEach(() => rpc.mockReset())

describe('normalizarPlaca', () => {
  it('maiúsculas, sem hífen e sem espaços', () => {
    expect(normalizarPlaca('abc-1d23')).toBe('ABC1D23')
    expect(normalizarPlaca(' abc 1234 ')).toBe('ABC1234')
  })
})

describe('veiculos', () => {
  it('meus lê a lista', async () => {
    rpc.mockResolvedValue({ data: { ok: true, veiculos: [{ id: 'v1' }] }, error: null })
    expect(await veiculos.meus()).toEqual([{ id: 'v1' }])
    expect(rpc).toHaveBeenCalledWith('meus_veiculos', {})
  })
  it('salvar normaliza a placa e mudarSituacao chama o banco', async () => {
    rpc.mockResolvedValue({ data: { ok: true, id: 'v1' }, error: null })
    await veiculos.salvar({ modelo: 'Van', cor: 'Branca', placa: 'abc-1d23', lugares: 8, carga_max_kg: 500, categorias: ['PASSAGEIROS'] })
    expect(rpc).toHaveBeenCalledWith('salvar_veiculo', { p: expect.objectContaining({ placa: 'ABC1D23' }) })
    await veiculos.mudarSituacao('v1', 'MANUTENCAO')
    expect(rpc).toHaveBeenLastCalledWith('mudar_situacao_veiculo', { p_id: 'v1', p_situacao: 'MANUTENCAO' })
  })
})

describe('validarVeiculo', () => {
  const cheio = {
    ...FORM_VEICULO_VAZIO,
    modelo: ' Toyota Hilux ',
    cor: 'Branca',
    placa: 'abc-1d23',
    lugares: '4',
    cargaMaxKg: '800',
    categorias: ['PASSAGEIROS', 'CARGA_LEVE'] as CodigoCategoria[],
  }
  it('monta a entrada do banco (placa normalizada, números inteiros, reboque vazio vira nulo)', () => {
    expect(validarVeiculo(cheio)).toEqual({
      ok: true,
      entrada: {
        modelo: 'Toyota Hilux',
        cor: 'Branca',
        placa: 'ABC1D23',
        lugares: 4,
        carga_max_kg: 800,
        reboque_desc: null,
        categorias: ['PASSAGEIROS', 'CARGA_LEVE'],
      },
    })
  })
  it('erros por campo: placa fora do padrão, sem categoria, números fora da faixa', () => {
    const r = validarVeiculo({ ...cheio, placa: 'AB-123', lugares: '61', cargaMaxKg: 'x', modelo: '', categorias: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(['cargaMaxKg', 'categorias', 'lugares', 'modelo', 'placa'])
  })
})
