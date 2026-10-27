import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
// No CI não há VITE_SUPABASE_URL para os testes de unidade: o cliente é simulado.
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const { pedidos } = await import('./pedidos.ts')

beforeEach(() => rpc.mockReset())

const DE = new Date('2026-10-27T03:00:00Z')
const ATE = new Date('2026-10-28T02:59:59Z')
const BLOCO = { inicio: '2026-10-27T12:00:00Z', fim: '2026-10-27T14:00:00Z', ocupado: true }
const CONCLUIDA = {
  id: 'a1',
  numero: 18,
  inicio: '2026-10-27T09:00:00Z',
  duracao_min: 120,
  origem: 'Porto de Itajaí',
  destino: 'Blumenau',
  categoria_nome: 'IVO Passageiros',
  status: 'CONCLUIDA',
}

describe('agenda (v2.2)', () => {
  it('agendaCompleta traz os blocos e as concluídas', async () => {
    rpc.mockResolvedValue({ data: { ok: true, blocos: [BLOCO], concluidas: [CONCLUIDA] }, error: null })
    expect(await pedidos.agendaCompleta(DE, ATE)).toEqual({ blocos: [BLOCO], concluidas: [CONCLUIDA] })
    expect(rpc).toHaveBeenCalledWith('agenda', { p_de: DE.toISOString(), p_ate: ATE.toISOString() })
  })
  it('banco anterior (sem concluidas): lista vazia; agenda continua só com os blocos', async () => {
    rpc.mockResolvedValue({ data: { ok: true, blocos: [BLOCO] }, error: null })
    expect(await pedidos.agendaCompleta(DE, ATE)).toEqual({ blocos: [BLOCO], concluidas: [] })
    expect(await pedidos.agenda(DE, ATE)).toEqual([BLOCO])
  })
})
