import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ValoresContrato } from './contratos.ts'

const rpc = vi.fn()
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const { categoriasAdm, formularioPrecos, precosDaVersao, validarPrecos } = await import('./categoriasAdm.ts')

beforeEach(() => rpc.mockReset())

const CONTRATO = {
  km_sem_reboque_cent: 350,
  km_com_reboque_cent: 520,
  taxa_fixa_reboque_cent: 15000,
} as ValoresContrato

describe('precosDaVersao', () => {
  it('versão com preço por categoria: o preço dela', () => {
    const precos = {
      PASSAGEIROS: { km_cent: 300, taxa_fixa_cent: 0 },
      CARGA_LEVE: { km_cent: 500, taxa_fixa_cent: 0 },
      CARGA_PESADA: { km_cent: 700, taxa_fixa_cent: 20000 },
    }
    expect(precosDaVersao(CONTRATO, precos)).toEqual(precos)
  })
  it('versão antiga: cada categoria cai nos campos de hoje (Carga Pesada com reboque e taxa)', () => {
    expect(precosDaVersao(CONTRATO, null)).toEqual({
      PASSAGEIROS: { km_cent: 350, taxa_fixa_cent: 0 },
      CARGA_LEVE: { km_cent: 350, taxa_fixa_cent: 0 },
      CARGA_PESADA: { km_cent: 520, taxa_fixa_cent: 15000 },
    })
  })
  it('sem versão: nada', () => {
    expect(precosDaVersao(null, null)).toBeNull()
  })
})

describe('validarPrecos', () => {
  it('"5,00" vira 500 centavos; a taxa só vale para a Carga Pesada (as outras vão 0)', () => {
    const f = formularioPrecos(null)
    f.PASSAGEIROS.km = '3,50'
    f.PASSAGEIROS.taxa = '99,00'
    f.CARGA_LEVE.km = '5,00'
    f.CARGA_PESADA.km = '7'
    f.CARGA_PESADA.taxa = '150,00'
    expect(validarPrecos(f)).toEqual({
      ok: true,
      precos: {
        PASSAGEIROS: { km_cent: 350, taxa_fixa_cent: 0 },
        CARGA_LEVE: { km_cent: 500, taxa_fixa_cent: 0 },
        CARGA_PESADA: { km_cent: 700, taxa_fixa_cent: 15000 },
      },
    })
  })
  it('km ou taxa inválidos: os erros por campo', () => {
    const f = formularioPrecos(null)
    f.PASSAGEIROS.km = 'abc'
    f.CARGA_LEVE.km = '5,00'
    f.CARGA_PESADA.km = '7,00'
    f.CARGA_PESADA.taxa = ''
    const r = validarPrecos(f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(['CARGA_PESADA.taxa', 'PASSAGEIROS.km'])
  })
  it('o formulário parte dos preços atuais', () => {
    expect(formularioPrecos(precosDaVersao(CONTRATO, null))).toEqual({
      PASSAGEIROS: { km: '3,50', taxa: '' },
      CARGA_LEVE: { km: '3,50', taxa: '' },
      CARGA_PESADA: { km: '5,20', taxa: '150,00' },
    })
  })
})

describe('categoriasAdm', () => {
  it('lê, salva a categoria e publica só pela RPC nova', async () => {
    rpc.mockResolvedValue({ data: { ok: true, categorias: [], precos: null }, error: null })
    await categoriasAdm.ler('e1', 3)
    expect(rpc).toHaveBeenCalledWith('categorias_adm', { p_empresa: 'e1', p_versao: 3 })
    await categoriasAdm.salvar({ codigo: 'CARGA_LEVE', nome: 'IVO Carga Leve', descricao_curta: 'até 800 kg', ordem: 2, ativa: false })
    expect(rpc).toHaveBeenLastCalledWith('salvar_categoria', {
      p: { codigo: 'CARGA_LEVE', nome: 'IVO Carga Leve', descricao_curta: 'até 800 kg', ordem: 2, ativa: false },
    })
    const quando = new Date('2026-10-21T12:00:00Z')
    const precos = {
      PASSAGEIROS: { km_cent: 1, taxa_fixa_cent: 0 },
      CARGA_LEVE: { km_cent: 2, taxa_fixa_cent: 0 },
      CARGA_PESADA: { km_cent: 3, taxa_fixa_cent: 4 },
    }
    await categoriasAdm.publicar(null, CONTRATO, precos, quando)
    expect(rpc).toHaveBeenLastCalledWith('publicar_contrato_categorias', {
      p_empresa: null,
      p: CONTRATO,
      p_categorias: precos,
      p_vigente_desde: quando.toISOString(),
    })
    expect(rpc.mock.calls.some((c) => c[0] === 'publicar_contrato')).toBe(false)
  })
})
