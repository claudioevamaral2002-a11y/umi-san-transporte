import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { CHAVE_PUBLICA, URL_SUPABASE, clientePublico, criarUsuario } from './ajuda.ts'

describe('superfície da API (especificação 1.1 e segurança item 10)', () => {
  let token = ''
  beforeAll(async () => {
    token = (await criarUsuario()).token
  })

  const autenticado = (extra: Record<string, string> = {}) => ({
    apikey: CHAVE_PUBLICA,
    Authorization: `Bearer ${token}`,
    ...extra,
  })

  it('api.ping responde para usuário autenticado', async () => {
    const r = await fetch(`${URL_SUPABASE}/rest/v1/rpc/ping`, {
      method: 'POST',
      headers: autenticado({ 'Content-Type': 'application/json', 'Content-Profile': 'api' }),
      body: '{}',
    })
    expect(r.status).toBe(200)
    expect(await r.json()).toBe('pong')
  })

  it('cadastro público está fechado (Adendo A3)', async () => {
    const { data, error } = await clientePublico().auth.signUp({
      email: `novo-${randomUUID()}@teste.local`,
      password: `Senha-${randomUUID()}`,
    })
    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
  })

  it('sem header Authorization a RPC é recusada (CSRF não se aplica)', async () => {
    const r = await fetch(`${URL_SUPABASE}/rest/v1/rpc/ping`, {
      method: 'POST',
      headers: { apikey: CHAVE_PUBLICA, 'Content-Type': 'application/json', 'Content-Profile': 'api' },
      body: '{}',
    })
    expect(r.ok).toBe(false)
  })

  it.each(['app', 'interno', 'public'])('schema %s não é servido pela API', async (schema) => {
    const r = await fetch(`${URL_SUPABASE}/rest/v1/prova_canal?select=id`, {
      headers: autenticado({ 'Accept-Profile': schema }),
    })
    expect(r.status).toBe(406)
  })

  it.each([
    ['POST', ''],
    ['PATCH', '?id=not.is.null'],
    ['DELETE', '?id=not.is.null'],
  ])('escrita direta %s em app.prova_canal é recusada', async (metodo, filtro) => {
    const r = await fetch(`${URL_SUPABASE}/rest/v1/prova_canal${filtro}`, {
      method: metodo,
      headers: autenticado({ 'Content-Type': 'application/json', 'Content-Profile': 'app' }),
      body: metodo === 'DELETE' ? undefined : JSON.stringify({ status: 'X' }),
    })
    expect(r.ok).toBe(false)
  })
})
