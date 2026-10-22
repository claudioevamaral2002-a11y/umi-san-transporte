import { describe, expect, it, vi } from 'vitest'
import type { DetalhePedido } from '../../../lib/pedidos.ts'
import type { Veiculo } from '../../../lib/veiculos.ts'

// Sem o Supabase de verdade (o CI de unidade não tem as variáveis do projeto): só as regras puras.
vi.mock('../../../lib/supabase.ts', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('../../../lib/funcoes.ts', () => ({ chamarFuncao: vi.fn() }))

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
  it('Carga Pesada e Carga Leve (4.1) com reboque; Passageiros sem, mesmo que o pedido diga outra coisa', () => {
    expect(usaReboque(pedido({ categoria: 'CARGA_PESADA', reboque: 'NAO' }))).toBe(true)
    expect(usaReboque(pedido({ categoria: 'CARGA_LEVE', reboque: 'NAO' }))).toBe(true)
    expect(usaReboque(pedido({ categoria: 'PASSAGEIROS', reboque: 'SIM' }))).toBe(false)
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

// Fase 4.1 (Tarefa 7): tarifa da categoria, veículo do cliente e paradas.
const {
  entradaDaChamada,
  entradaDaSonda,
  itensDaSonda,
  itensPadrao,
  paradasAlcancadas,
  paradasDoPedido,
  paradasPendentes,
  pontosDasParadas,
  veiculoDoCliente,
} = await import('./chamada.ts')

const motorista = (extra: Record<string, unknown> = {}) =>
  pedido({ categoria: 'MOTORISTA', modalidade: 'VEICULO_CLIENTE', reboque: 'NAO', horas_estimadas: 4, ...extra } as Partial<DetalhePedido>)

describe('reboque pelo banco nas categorias novas (4.1)', () => {
  it('categoria criada pelo Master: o reboque gravado no pedido', () => {
    expect(usaReboque(pedido({ categoria: 'GUINCHO', reboque: 'SIM' }))).toBe(true)
    expect(usaReboque(pedido({ categoria: 'VAN', reboque: 'NAO' }))).toBe(false)
  })
  it('veículo do cliente (IVO Motorista) nunca tem reboque', () => {
    expect(usaReboque(motorista({ reboque: 'SIM' }))).toBe(false)
    expect(veiculoDoCliente(motorista())).toBe(true)
    expect(veiculoDoCliente(pedido({ categoria: null, modalidade: 'VEICULO_CLIENTE' }))).toBe(false)
  })
})

describe('km com paradas em ida e volta', () => {
  it('ida pelas paradas + volta direta, cada uma com uma casa', () => {
    expect(kmDecimosDaRota(30.04, 2, 21.06)).toBe(300 + 211)
    expect(kmDecimosDaRota(30.04, 1, 21.06)).toBe(300)
  })
})

describe('itens pela tarifa (sondagem)', () => {
  it('a sondagem pede uma unidade de cada; sem categoria, sem horas e paradas', () => {
    expect(entradaDaSonda(motorista())).toEqual({
      modalidade: 'VEICULO_CLIENTE',
      km: 1,
      usa_reboque: false,
      espera_horas: 1,
      pedagio_cent: 0,
      hospedagem_diarias: 1,
      horas: 1,
      paradas: 1,
    })
    const semCategoria = entradaDaSonda(pedido({ categoria: null }))
    expect(semCategoria).not.toHaveProperty('horas')
    expect(semCategoria).not.toHaveProperty('paradas')
  })
  it('só os itens com linha (zerado = não cobra)', () => {
    expect(itensDaSonda([{ codigo: 'HORAS' }, { codigo: 'HOSPEDAGEM' }])).toEqual({
      km: false,
      horas: true,
      espera: false,
      paradas: false,
      hospedagem: true,
      reboque: false,
    })
    expect(itensDaSonda([{ codigo: 'KM_COM_REBOQUE' }, { codigo: 'PARADAS' }])).toMatchObject({ km: true, reboque: true, paradas: true })
  })
  it('sem a sondagem: os itens de antes, e as horas se o pedido tem', () => {
    expect(itensPadrao(motorista())).toMatchObject({ km: true, horas: true, espera: true, hospedagem: true })
    expect(itensPadrao(pedido())).toMatchObject({ horas: false })
  })
})

describe('entrada da calculadora (4.1)', () => {
  it('IVO Motorista: VEICULO_CLIENTE, as horas e nunca diárias', () => {
    const f = { ...formDaTabela(motorista(), 42), horasMeias: 9 }
    const m = entradaDaChamada(f, motorista(), { horas: true })
    expect(m.ok && m.entrada).toEqual({
      modalidade: 'VEICULO_CLIENTE',
      km: 42,
      usa_reboque: false,
      espera_horas: 0,
      pedagio_cent: 0,
      hospedagem_diarias: 0,
      horas: 4.5,
    })
  })
  it('tabela ("Aceitar"): sem horas, o banco usa as do pedido', () => {
    const m = entradaDaChamada(formDaTabela(motorista(), 42), motorista())
    expect(m.ok && m.entrada).not.toHaveProperty('horas')
    expect(formDaTabela(motorista(), 42).horasMeias).toBe(8)
  })
  it('veículo próprio: a mesma entrada de antes', () => {
    const m = entradaDaChamada(formDaTabela(pedido(), 21.04), pedido(), { horas: false })
    expect(m.ok && m.entrada).toEqual({
      modalidade: 'VEICULO_PROPRIO',
      km: 21,
      usa_reboque: false,
      espera_horas: 0,
      pedagio_cent: 0,
      hospedagem_diarias: 0,
    })
  })
  it('revisão da IVO Motorista: começa do orçamento anterior, com as horas dele', () => {
    const f = formDaCalculadora(motorista(), { modalidade: 'VEICULO_CLIENTE', km: 42, horas: 5, hospedagem_diarias: 1, diarias: 2 }, 40)
    expect(f).toMatchObject({ modalidade: 'VEICULO_PROPRIO', kmDecimos: 420, horasMeias: 10, hospedagemDiarias: 1, diarias: 0, usaReboque: false })
  })
})

describe('paradas da viagem', () => {
  const p = pedido({
    paradas: [
      { texto: 'Detroit', place_id: null, lat: -26.95, lng: -48.7 },
      { texto: 'Porto', place_id: 'ChIJpor', lat: null, lng: null },
      { texto: 'Só texto', place_id: null, lat: null, lng: null },
      'lixo',
    ],
  } as Partial<DetalhePedido>)
  it('lidas com cuidado; a rota passa pelas que têm ponto, na ordem', () => {
    expect(paradasDoPedido(p).map((x) => x.texto)).toEqual(['Detroit', 'Porto', 'Só texto'])
    expect(pontosDasParadas(p)).toEqual([{ lat: -26.95, lng: -48.7 }, { place_id: 'ChIJpor' }])
    expect(paradasDoPedido(pedido())).toEqual([])
  })
  it('a 150 m conta como passada; mais longe, não; a lista não muda sem novidade', () => {
    const coords = [{ lat: -26.95, lng: -48.7 }, undefined, null]
    const nada: number[] = []
    expect(paradasAlcancadas(coords, { lat: -26.9518, lng: -48.7 }, nada)).toBe(nada)
    expect(paradasAlcancadas(coords, { lat: -26.95126, lng: -48.7 }, nada)).toEqual([0])
    expect(paradasAlcancadas(coords, null, nada)).toBe(nada)
  })
  it('pendentes: as não passadas com ponto (ou buscando); só texto fica de fora', () => {
    expect(paradasPendentes([{ lat: 0, lng: 0 }, undefined, null], [])).toEqual([0, 1])
    expect(paradasPendentes([{ lat: 0, lng: 0 }, undefined, null], [0])).toEqual([1])
  })
})
