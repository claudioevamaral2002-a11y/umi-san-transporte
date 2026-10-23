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

describe('categoriasAdm (fase 4.1)', () => {
  const TARIFA = {
    taxa_fixa_cent: 0,
    km_cent: 350,
    hora_cent: 0,
    hora_espera_cent: 0,
    parada_cent: 0,
    retorno_bp: 0,
    reboque_cent: 0,
    hospedagem_diaria_cent: 0,
  }
  it('publicarTarifas chama publicar_tarifas com todas as categorias e a vigência em ISO', async () => {
    rpc.mockResolvedValue({ data: { ok: true, versao: 4 }, error: null })
    const quando = new Date('2026-10-23T12:00:00Z')
    const r = await categoriasAdm.publicarTarifas('e1', { PASSAGEIROS: TARIFA, MOTORISTA: { ...TARIFA, hora_cent: 4500 } }, quando)
    expect(rpc).toHaveBeenCalledWith('publicar_tarifas', {
      p_empresa: 'e1',
      p_tarifas: { PASSAGEIROS: TARIFA, MOTORISTA: { ...TARIFA, hora_cent: 4500 } },
      p_vigente_desde: quando.toISOString(),
    })
    expect(r).toEqual({ ok: true, versao: 4 })
  })
  it('publicarTarifas com empresa nula vale para a tabela modelo', async () => {
    rpc.mockResolvedValue({ data: { ok: true, versao: 2 }, error: null })
    await categoriasAdm.publicarTarifas(null, { PASSAGEIROS: TARIFA }, new Date('2026-10-23T12:00:00Z'))
    expect(rpc).toHaveBeenLastCalledWith('publicar_tarifas', expect.objectContaining({ p_empresa: null }))
  })
  it('salvar cria sem código (devolve o código gerado) e manda os campos novos', async () => {
    rpc.mockResolvedValue({ data: { ok: true, codigo: 'GUINCHO' }, error: null })
    const r = await categoriasAdm.salvar({
      nome: 'IVO Guincho',
      descricao_curta: 'Leva o carro',
      ordem: 5,
      ativa: true,
      veiculo_cliente: false,
      reboque: 'SIM',
      carga: 'EQUIPAMENTO',
    })
    expect(rpc).toHaveBeenCalledWith('salvar_categoria', {
      p: { nome: 'IVO Guincho', descricao_curta: 'Leva o carro', ordem: 5, ativa: true, veiculo_cliente: false, reboque: 'SIM', carga: 'EQUIPAMENTO' },
    })
    expect(r.codigo).toBe('GUINCHO')
  })
  it('salvar só manda as chaves que o banco aceita (a leitura traz tarifa, que ele recusaria)', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    const lida = {
      codigo: 'MOTORISTA',
      nome: 'IVO Motorista',
      descricao_curta: 'x',
      ordem: 3,
      ativa: true,
      carga: 'PESSOAS',
      reboque: 'NAO',
      veiculo_cliente: true,
      tarifa: { ...TARIFA, inicial: true },
    } as unknown as Parameters<typeof categoriasAdm.salvar>[0]
    await categoriasAdm.salvar(lida)
    const p = (rpc.mock.calls.at(-1)?.[1] as { p: Record<string, unknown> }).p
    expect(Object.keys(p).sort()).toEqual(['ativa', 'carga', 'codigo', 'descricao_curta', 'nome', 'ordem', 'reboque', 'veiculo_cliente'])
  })
  it('listar devolve as categorias do banco', async () => {
    rpc.mockResolvedValue({ data: { ok: true, categorias: [{ codigo: 'A' }], precos: null }, error: null })
    expect(await categoriasAdm.listar()).toEqual([{ codigo: 'A' }])
    expect(rpc).toHaveBeenLastCalledWith('categorias_adm', { p_empresa: null, p_versao: null })
  })
})

describe('categoriasAdm (v2.1)', () => {
  it('excluir chama excluir_categoria com o código', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'CATEGORIA_EM_USO' }, error: null })
    const r = await categoriasAdm.excluir('PASSAGEIROS')
    expect(rpc).toHaveBeenCalledWith('excluir_categoria', { p_codigo: 'PASSAGEIROS' })
    expect(r).toEqual({ ok: false, codigo: 'CATEGORIA_EM_USO' })
  })
  it('salvar não manda pode_excluir (a leitura traz, o banco recusaria)', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await categoriasAdm.salvar({ codigo: 'GUINCHO', nome: 'IVO Guincho', descricao_curta: 'x', ordem: 5, ativa: true, pode_excluir: true })
    expect(rpc).toHaveBeenLastCalledWith('salvar_categoria', {
      p: { codigo: 'GUINCHO', nome: 'IVO Guincho', descricao_curta: 'x', ordem: 5, ativa: true },
    })
  })
})
