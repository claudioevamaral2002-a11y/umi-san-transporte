import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const { corrida, limitesAjuste } = await import('./corrida.ts')

beforeEach(() => rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null }))

describe('limitesAjuste', () => {
  it('−50% (arredondado meio para cima) a +100% da tabela', () => {
    expect(limitesAjuste(18000)).toEqual({ min: -9000, max: 18000 })
    expect(limitesAjuste(10001)).toEqual({ min: -5001, max: 10001 })
    expect(limitesAjuste(10003)).toEqual({ min: -5002, max: 10003 })
    expect(limitesAjuste(0)).toEqual({ min: 0, max: 0 })
  })
})

describe('corrida', () => {
  it('enviarProposta junta as chaves da corrida à entrada, com o ajuste como texto', async () => {
    await corrida.enviarProposta('a1', { km: '10' }, { veiculo_id: 'v1', ajuste_cent: -500, ajuste_motivo: 'trânsito' }, null)
    expect(rpc).toHaveBeenCalledWith('enviar_orcamento', {
      p_atividade: 'a1',
      p: { km: '10', veiculo_id: 'v1', ajuste_cent: '-500', ajuste_motivo: 'trânsito' },
      p_horario_sugerido: null,
    })
  })
  it('sem ajuste, não manda as chaves de ajuste', async () => {
    await corrida.enviarProposta('a1', { km: '10' }, { veiculo_id: 'v1' }, null)
    expect(rpc.mock.calls[0]![1].p).toEqual({ km: '10', veiculo_id: 'v1' })
  })
  it('confirmar e avaliar', async () => {
    await corrida.confirmar('a1', 2, 'h', 'c-uuid', 'CC1')
    expect(rpc).toHaveBeenLastCalledWith('confirmar_corrida', {
      p_atividade: 'a1',
      p_versao: 2,
      p_hash: 'h',
      p_chave: 'c-uuid',
      p_centro_custo: 'CC1',
      p_dispositivo: null,
    })
    await corrida.avaliar('a1', 5, null)
    expect(rpc).toHaveBeenLastCalledWith('avaliar', { p_atividade: 'a1', p_nota: 5, p_comentario: null })
  })
})
