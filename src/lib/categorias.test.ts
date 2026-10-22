import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FORM_VAZIO } from './novoPedido.ts'

const rpc = vi.fn()
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const {
  HORAS_MAX,
  HORAS_MIN,
  MAX_CENTRO_CUSTO,
  categorias,
  comPreenchimento,
  horasValidas,
  kmDaRota,
  kmDoPedido,
  mudarHoras,
  pedidoDaCategoria,
  primeiroHorarioAgora,
  toleranciaKm,
} = await import('./categorias.ts')

beforeEach(() => rpc.mockReset())

describe('primeiroHorarioAgora', () => {
  const livres = ['2026-10-20T09:00:00.000Z', '2026-10-20T10:00:00.000Z']
  it('devolve o primeiro horário a partir de agora + 60 min', () => {
    expect(primeiroHorarioAgora(livres, new Date('2026-10-20T08:30:00.000Z'))).toBe(livres[1])
  })
  it('aceita exatamente agora + 60 min', () => {
    expect(primeiroHorarioAgora(livres, new Date('2026-10-20T08:00:00.000Z'))).toBe(livres[0])
  })
  it('às 23h30 sem horário no dia: null (a tela busca o dia seguinte)', () => {
    expect(primeiroHorarioAgora(['2026-10-20T23:00:00.000Z'], new Date('2026-10-20T23:30:00.000Z'))).toBeNull()
    expect(primeiroHorarioAgora([], new Date())).toBeNull()
  })
})

describe('pedidoDaCategoria', () => {
  const base = {
    ...FORM_VAZIO,
    inicio: '2026-10-20T12:00:00.000Z',
    origem: 'Rua A, 1',
    destino: 'Rua B, 2',
    levar: true,
    equipamentoDesc: 'Gerador',
    modalidade: 'VEICULO_CLIENTE' as const,
  }
  it('CARGA_PESADA: equipamento com reboque, veículo próprio e categoria', () => {
    const p = pedidoDaCategoria(
      { codigo: 'CARGA_PESADA', nome: 'Carga pesada', descricao_curta: '', disponivel: true, veiculo_cliente: false, cobra_hora: false, cobra_parada: false, total_cent: 1, carga: 'EQUIPAMENTO', reboque: 'SIM' },
      base,
    )
    expect(p).toMatchObject({ categoria: 'CARGA_PESADA', carga: 'EQUIPAMENTO', reboque: 'SIM', modalidade: 'VEICULO_PROPRIO', equipamento_desc: 'Gerador' })
    expect(p).not.toHaveProperty('pessoas_qtd')
  })
  it('PASSAGEIROS: pessoas, sem reboque, com agora', () => {
    const p = pedidoDaCategoria(
      { codigo: 'PASSAGEIROS', nome: 'Passageiros', descricao_curta: '', disponivel: true, veiculo_cliente: false, cobra_hora: false, cobra_parada: false, total_cent: 1, carga: 'PESSOAS', reboque: 'NAO' },
      base,
      { agora: true },
    )
    expect(p).toMatchObject({ categoria: 'PASSAGEIROS', carga: 'PESSOAS', reboque: 'NAO', agora: true })
    expect(p).not.toHaveProperty('equipamento_desc')
  })
})

describe('pedidoDaCategoria (fase 4.1)', () => {
  const base = {
    ...FORM_VAZIO,
    inicio: '2026-10-20T12:00:00.000Z',
    origem: 'Rua A, 1',
    destino: 'Rua B, 2',
    levar: true,
    trazer: false,
    pessoasQtd: 1,
  }
  const motorista = {
    codigo: 'MOTORISTA',
    nome: 'IVO Motorista',
    descricao_curta: 'Ivo dirige o carro da sua empresa',
    disponivel: true,
    veiculo_cliente: true,
    cobra_hora: true,
    cobra_parada: false,
    total_cent: 36000,
    carga: 'PESSOAS' as const,
    reboque: 'NAO' as const,
  }
  it('MOTORISTA: leva horas_estimadas e a modalidade VEICULO_CLIENTE', () => {
    const p = pedidoDaCategoria(motorista, base, { horas: 4.5 })
    expect(p).toMatchObject({ categoria: 'MOTORISTA', modalidade: 'VEICULO_CLIENTE', horas_estimadas: 4.5, reboque: 'NAO' })
  })
  it('categoria que não cobra por hora não manda horas_estimadas', () => {
    const p = pedidoDaCategoria({ ...motorista, codigo: 'PASSAGEIROS', veiculo_cliente: false, cobra_hora: false }, base, { horas: 4 })
    expect(p).not.toHaveProperty('horas_estimadas')
  })
  it('categoria com veículo da IVO continua em VEICULO_PROPRIO', () => {
    const p = pedidoDaCategoria({ ...motorista, codigo: 'PASSAGEIROS', veiculo_cliente: false }, base)
    expect(p.modalidade).toBe('VEICULO_PROPRIO')
  })
  it('sem paradas, horas e centro de custo, o corpo não ganha essas chaves', () => {
    const p = pedidoDaCategoria({ ...motorista, veiculo_cliente: false, cobra_hora: false }, base)
    expect(p).not.toHaveProperty('paradas')
    expect(p).not.toHaveProperty('horas_estimadas')
    expect(p).not.toHaveProperty('centro_custo')
  })
  it('paradas no formato do banco (do Google só o place_id) e centro de custo aparado', () => {
    const p = pedidoDaCategoria(motorista, base, {
      paradas: [{ texto: ' Posto 1 ', place_id: 'ChIJa' }, { texto: 'Ponto 2', lat: -26.3, lng: -48.8 }],
      centroCusto: '  Obra 12  ',
    })
    expect(p.paradas).toEqual([
      { texto: 'Posto 1', place_id: 'ChIJa' },
      { texto: 'Ponto 2', lat: -26.3, lng: -48.8 },
    ])
    expect(p.centro_custo).toBe('Obra 12')
  })
  it('centro de custo vazio não vai; lista de paradas vazia não vai', () => {
    const p = pedidoDaCategoria(motorista, base, { paradas: [], centroCusto: '   ' })
    expect(p).not.toHaveProperty('paradas')
    expect(p).not.toHaveProperty('centro_custo')
  })
})

describe('comPreenchimento (fase 4.1)', () => {
  const k = { nome: 'n', descricao_curta: 'd', disponivel: true, veiculo_cliente: false, cobra_hora: false, cobra_parada: false, total_cent: 1 }
  it('categoria criada pelo Master: usa a carga e o reboque que o banco devolveu', () => {
    expect(comPreenchimento({ ...k, codigo: 'GUINCHO', carga: 'EQUIPAMENTO', reboque: 'SIM' })).toMatchObject({
      codigo: 'GUINCHO',
      carga: 'EQUIPAMENTO',
      reboque: 'SIM',
    })
  })
  it('sem carga do banco, as três antigas caem no preenchimento de hoje; código desconhecido é null', () => {
    expect(comPreenchimento({ ...k, codigo: 'PASSAGEIROS' })).toMatchObject({ carga: 'PESSOAS', reboque: 'NAO' })
    expect(comPreenchimento({ ...k, codigo: 'OUTRA' })).toBeNull()
  })
})

describe('horas estimadas', () => {
  it('de 0,5 a 24 em passos de 0,5', () => {
    expect(HORAS_MIN).toBe(0.5)
    expect(HORAS_MAX).toBe(24)
    for (const h of [0.5, 1, 4.5, 24]) expect(horasValidas(h)).toBe(true)
    for (const h of [0, 0.25, 24.5, -1, Number.NaN, 1.3]) expect(horasValidas(h)).toBe(false)
  })
  it('mudarHoras: − e + em passos de 0,5, presos aos limites', () => {
    expect(mudarHoras(2, 1)).toBe(2.5)
    expect(mudarHoras(2, -1)).toBe(1.5)
    expect(mudarHoras(0.5, -1)).toBe(0.5)
    expect(mudarHoras(24, 1)).toBe(24)
  })
  it('centro de custo: até 80 caracteres', () => {
    expect(MAX_CENTRO_CUSTO).toBe(80)
  })
})

describe('categorias.disponiveis', () => {
  it('manda o km como número JSON e devolve as categorias', async () => {
    const cats = [{ codigo: 'PASSAGEIROS', nome: 'P', descricao_curta: 'x', disponivel: true, veiculo_cliente: false, cobra_hora: false, cobra_parada: false, total_cent: 100 }]
    rpc.mockResolvedValue({ data: { ok: true, categorias: cats }, error: null })
    const r = await categorias.disponiveis({ km: 12.5, levar: true, trazer: false })
    expect(rpc).toHaveBeenCalledWith('categorias_disponiveis', { p: { km: 12.5, levar: true, trazer: false } })
    expect(r.categorias).toEqual(cats)
  })
  it('paradas presas a 0..3 e horas inválidas não vão', async () => {
    rpc.mockResolvedValue({ data: { ok: true, categorias: [] }, error: null })
    await categorias.disponiveis({ km: 10, levar: true, trazer: false, paradas: 3, horas: 24.5 })
    expect(rpc).toHaveBeenLastCalledWith('categorias_disponiveis', { p: { km: 10, levar: true, trazer: false, paradas: 3 } })
    await categorias.disponiveis({ km: 10, levar: true, trazer: false, paradas: 7 })
    expect(rpc).toHaveBeenLastCalledWith('categorias_disponiveis', { p: { km: 10, levar: true, trazer: false, paradas: 3 } })
    await categorias.disponiveis({ km: 10, levar: true, trazer: false, paradas: -2 })
    expect(rpc).toHaveBeenLastCalledWith('categorias_disponiveis', { p: { km: 10, levar: true, trazer: false, paradas: 0 } })
  })
  it('manda paradas (quantidade) e horas só quando existem', async () => {
    rpc.mockResolvedValue({ data: { ok: true, categorias: [] }, error: null })
    await categorias.disponiveis({ km: 10, levar: true, trazer: true, paradas: 2, horas: 4.5 })
    expect(rpc).toHaveBeenLastCalledWith('categorias_disponiveis', { p: { km: 10, levar: true, trazer: true, paradas: 2, horas: 4.5 } })
    await categorias.disponiveis({ km: 10, levar: true, trazer: false, paradas: 0, horas: null })
    expect(rpc).toHaveBeenLastCalledWith('categorias_disponiveis', { p: { km: 10, levar: true, trazer: false, paradas: 0 } })
  })
  it('km_volta (volta direta) só em ida e volta, com uma casa e até 5000', async () => {
    rpc.mockResolvedValue({ data: { ok: true, categorias: [] }, error: null })
    await categorias.disponiveis({ km: 48.2, kmVolta: 41.04, levar: true, trazer: true, paradas: 1 })
    expect(rpc).toHaveBeenLastCalledWith('categorias_disponiveis', {
      p: { km: 48.2, levar: true, trazer: true, paradas: 1, km_volta: 41 },
    })
    // Trecho único: a volta não vai.
    await categorias.disponiveis({ km: 48.2, kmVolta: 41, levar: true, trazer: false })
    expect(rpc).toHaveBeenLastCalledWith('categorias_disponiveis', { p: { km: 48.2, levar: true, trazer: false } })
    for (const ruim of [null, undefined, Number.NaN, -1, 5000.1, Infinity]) {
      await categorias.disponiveis({ km: 48.2, kmVolta: ruim, levar: true, trazer: true })
      expect(rpc).toHaveBeenLastCalledWith('categorias_disponiveis', { p: { km: 48.2, levar: true, trazer: true } })
    }
  })
})

describe('km da rota', () => {
  it('uma casa, meio para cima', () => {
    expect(kmDaRota(42.37)).toBe(42.4)
    expect(kmDaRota(42.34)).toBe(42.3)
  })
  it('tolerância: 1 km ou 1% da rota, o maior', () => {
    expect(toleranciaKm(42)).toBe(1)
    expect(toleranciaKm(250)).toBe(2.5)
  })
})

describe('kmDoPedido', () => {
  it('ida e volta soma ida (com paradas) e volta direta; só ida usa a ida', () => {
    expect(kmDoPedido({ ida: { km: 48.2 }, volta: { km: 41.0 }, levar: true, trazer: true })).toBe(89.2)
    expect(kmDoPedido({ ida: { km: 48.2 }, levar: true, trazer: false })).toBe(48.2)
    expect(kmDoPedido({ ida: { km: 48.2 }, volta: null, levar: true, trazer: true })).toBe(48.2)
    expect(kmDoPedido({ ida: { km: 48.2 }, volta: { km: 41.0 }, levar: true, trazer: false })).toBe(48.2)
    expect(kmDoPedido({ ida: null, levar: true, trazer: false })).toBeNull()
  })
})
