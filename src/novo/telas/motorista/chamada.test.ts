import { describe, expect, it, vi } from 'vitest'
import type { DetalhePedido } from '../../../lib/pedidos.ts'
import type { Veiculo } from '../../../lib/veiculos.ts'

vi.mock('../../../lib/supabase.ts', () => ({ supabase: { rpc: vi.fn() } }))

const { formDaCalculadora, formDaTabela, kmDecimosDaRota, trechos, usaReboque, veiculosDaChamada } = await import('./chamada.ts')
const { montarEntrada } = await import('../../../lib/orcar.ts')

const pedido = (extra: Partial<DetalhePedido> = {}) =>
  ({ categoria: 'PASSAGEIROS', reboque: 'NAO', levar: true, trazer: false, trechos_km: 1, modalidade: 'VEICULO_PROPRIO', ...extra }) as DetalhePedido

describe('km da rota (mesmo arredondamento do cliente)', () => {
  it('uma casa por trecho; ida e volta dobra depois de arredondar', () => {
    expect(kmDecimosDaRota(42.04, 1)).toBe(420)
    expect(kmDecimosDaRota(42.06, 1)).toBe(421)
    expect(kmDecimosDaRota(12.34, 2)).toBe(246)
  })
  it('trechos: o do banco, ou levar e trazer', () => {
    expect(trechos(pedido({ trechos_km: 2 }))).toBe(2)
    expect(trechos(pedido({ trechos_km: undefined, levar: true, trazer: true }))).toBe(2)
    expect(trechos(pedido())).toBe(1)
  })
})

describe('reboque fixo pela categoria', () => {
  it('Carga Pesada com reboque; Passageiros e Carga Leve sem, mesmo que o pedido diga outra coisa', () => {
    expect(usaReboque(pedido({ categoria: 'CARGA_PESADA', reboque: 'NAO' }))).toBe(true)
    expect(usaReboque(pedido({ categoria: 'CARGA_LEVE', reboque: 'SIM' }))).toBe(false)
  })
  it('sem categoria (pedido do app atual): o que o cliente pediu', () => {
    expect(usaReboque(pedido({ categoria: null, reboque: 'SIM' }))).toBe(true)
    expect(usaReboque(pedido({ categoria: null, reboque: 'NAO_SEI' }))).toBe(false)
  })
})

describe('entrada da tabela (o "Aceitar")', () => {
  it('só os km da rota, sem espera, pedágio, hospedagem, outros nem ajuste', () => {
    const m = montarEntrada(formDaTabela(pedido({ trechos_km: 2, levar: true, trazer: true }), 21.04))
    expect(m).toEqual({
      ok: true,
      entrada: { modalidade: 'VEICULO_PROPRIO', km: 42, usa_reboque: false, espera_horas: 0, pedagio_cent: 0, hospedagem_diarias: 0 },
    })
  })
  it('sem rota: km zero (a tela não oferece o aceite sem o valor)', () => {
    expect(formDaTabela(pedido(), null).kmDecimos).toBe(0)
  })
  it('revisão: a calculadora começa do orçamento anterior, com o reboque da categoria', () => {
    const f = formDaCalculadora(pedido({ categoria: 'CARGA_PESADA' }), { modalidade: 'VEICULO_PROPRIO', km: 48, espera_horas: 1, usa_reboque: false }, 42)
    expect(f).toMatchObject({ modalidade: 'VEICULO_PROPRIO', kmDecimos: 480, esperaMeias: 2, usaReboque: true, diarias: 0 })
  })
})

describe('veículos da chamada', () => {
  const v = (id: string, categorias: string[], situacao: string, criado: string) =>
    ({ id, categorias, situacao, criado_em: criado, modelo: 'M', cor: 'c', placa: 'P' }) as unknown as Veiculo
  const lista = [
    v('d', ['PASSAGEIROS'], 'ATIVO', '2026-10-05T00:00:00Z'),
    v('a', ['PASSAGEIROS'], 'MANUTENCAO', '2026-10-01T00:00:00Z'),
    v('b', ['CARGA_PESADA'], 'ATIVO', '2026-10-02T00:00:00Z'),
    v('c', ['PASSAGEIROS', 'CARGA_LEVE'], 'ATIVO', '2026-10-03T00:00:00Z'),
  ]
  it('só os ATIVOS da categoria, o mais antigo primeiro (o sugerido, como no banco)', () => {
    expect(veiculosDaChamada(lista, 'PASSAGEIROS').map((x) => x.id)).toEqual(['c', 'd'])
  })
  it('sem categoria: todos os ativos', () => {
    expect(veiculosDaChamada(lista, null).map((x) => x.id)).toEqual(['b', 'c', 'd'])
  })
})
