import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FORM_VAZIO } from './novoPedido.ts'

const rpc = vi.fn()
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const { categorias, kmDaRota, kmDoPedido, pedidoDaCategoria, primeiroHorarioAgora, toleranciaKm } = await import('./categorias.ts')

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
      { codigo: 'CARGA_PESADA', nome: 'Carga pesada', descricao_curta: '', disponivel: true, total_cent: 1, carga: 'EQUIPAMENTO', reboque: 'SIM' },
      base,
    )
    expect(p).toMatchObject({ categoria: 'CARGA_PESADA', carga: 'EQUIPAMENTO', reboque: 'SIM', modalidade: 'VEICULO_PROPRIO', equipamento_desc: 'Gerador' })
    expect(p).not.toHaveProperty('pessoas_qtd')
  })
  it('PASSAGEIROS: pessoas, sem reboque, com agora', () => {
    const p = pedidoDaCategoria(
      { codigo: 'PASSAGEIROS', nome: 'Passageiros', descricao_curta: '', disponivel: true, total_cent: 1, carga: 'PESSOAS', reboque: 'NAO' },
      base,
      { agora: true },
    )
    expect(p).toMatchObject({ categoria: 'PASSAGEIROS', carga: 'PESSOAS', reboque: 'NAO', agora: true })
    expect(p).not.toHaveProperty('equipamento_desc')
  })
})

describe('categorias.disponiveis', () => {
  it('manda o km como número JSON e devolve as categorias', async () => {
    const cats = [{ codigo: 'PASSAGEIROS', nome: 'P', descricao_curta: 'x', disponivel: true, total_cent: 100 }]
    rpc.mockResolvedValue({ data: { ok: true, categorias: cats }, error: null })
    const r = await categorias.disponiveis({ km: 12.5, levar: true, trazer: false })
    expect(rpc).toHaveBeenCalledWith('categorias_disponiveis', { p: { km: 12.5, levar: true, trazer: false } })
    expect(r.categorias).toEqual(cats)
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
