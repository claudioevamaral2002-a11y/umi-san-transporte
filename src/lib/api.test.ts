import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
// No CI não há VITE_SUPABASE_URL para os testes de unidade: o cliente é simulado.
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const { api } = await import('./api.ts')
const { ErroLeitura } = await import('./pedidos.ts')

beforeEach(() => rpc.mockReset())

describe('api.acoesAuditoria (v2.2)', () => {
  it('lê as ações com a contagem', async () => {
    rpc.mockResolvedValue({ data: { ok: true, acoes: [{ acao: 'CRIAR_PEDIDO', total: 9 }] }, error: null })
    expect(await api.acoesAuditoria()).toEqual([{ acao: 'CRIAR_PEDIDO', total: 9 }])
    expect(rpc).toHaveBeenCalledWith('acoes_auditoria', {})
  })
  it('recusa (não é Master) vira ErroLeitura com o código', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'SEM_PERMISSAO' }, error: null })
    await expect(api.acoesAuditoria()).rejects.toMatchObject({ codigo: 'SEM_PERMISSAO' })
    await expect(api.acoesAuditoria()).rejects.toBeInstanceOf(ErroLeitura)
  })
})
