import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
// No CI não há VITE_SUPABASE_URL para os testes de unidade: o cliente é simulado.
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const { excluirLocal, listarLocais, localDoPedido, nomeLocalValido, renomearLocal } = await import('./locais.ts')
const { ErroLeitura } = await import('./pedidos.ts')

beforeEach(() => rpc.mockReset())

const LOCAL = {
  id: 7,
  nome: 'Porto de Itajaí',
  usos: 12,
  ultimo_uso: '2026-10-20T12:00:00Z',
  place_id: 'ChIJabc',
  lat: null,
  lng: null,
}

describe('locais salvos (v2.2)', () => {
  it('listarLocais lê api.locais_empresa_todos', async () => {
    rpc.mockResolvedValue({ data: { ok: true, locais: [LOCAL] }, error: null })
    expect(await listarLocais()).toEqual([LOCAL])
    expect(rpc).toHaveBeenCalledWith('locais_empresa_todos', {})
  })
  it('listarLocais recusado vira ErroLeitura', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'SEM_PERMISSAO' }, error: null })
    await expect(listarLocais()).rejects.toBeInstanceOf(ErroLeitura)
  })
  it('renomearLocal apara o nome; a recusa volta como {ok:false, codigo}', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'NAO_ENCONTRADO' }, error: null })
    expect(await renomearLocal(7, '  Porto  ')).toEqual({ ok: false, codigo: 'NAO_ENCONTRADO' })
    expect(rpc).toHaveBeenCalledWith('renomear_local', { p_id: 7, p_nome: 'Porto' })
  })
  it('excluirLocal chama api.excluir_local; falha de rede vira ERRO_INESPERADO', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    expect(await excluirLocal(7)).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('excluir_local', { p_id: 7 })
    rpc.mockResolvedValue({ data: null, error: { message: 'rede' } })
    expect(await excluirLocal(7)).toEqual({ ok: false, codigo: 'ERRO_INESPERADO' })
  })
  it('nomeLocalValido: de 2 a 80 caracteres, sem contar as pontas', () => {
    expect(nomeLocalValido(' a ')).toBe(false)
    expect(nomeLocalValido('ab')).toBe(true)
    expect(nomeLocalValido('x'.repeat(80))).toBe(true)
    expect(nomeLocalValido('x'.repeat(81))).toBe(false)
  })
  it('localDoPedido: o ponto para o De do pedido', () => {
    expect(localDoPedido(LOCAL)).toEqual({ nome: 'Porto de Itajaí', endereco: null, lat: null, lng: null, place_id: 'ChIJabc' })
  })
})
