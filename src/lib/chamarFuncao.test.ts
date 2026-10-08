import { describe, expect, it } from 'vitest'
import { criarChamador } from './chamarFuncao.ts'

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

describe('criarChamador', () => {
  it('POST com Bearer, apikey e corpo JSON na URL da função', async () => {
    let pedido: { url: string; init?: RequestInit } | undefined
    const chamar = criarChamador({
      url: 'https://x.supabase.co/',
      chavePublica: 'sb_publishable_x',
      obterToken: async () => 'jwt.a.b',
      buscar: async (url, init) => {
        pedido = { url: String(url), init }
        return json({ ok: true, link: 'https://l' })
      },
    })
    expect(await chamar('convidar', { email: 'a@b.c' })).toEqual({ ok: true, link: 'https://l' })
    expect(pedido?.url).toBe('https://x.supabase.co/functions/v1/convidar')
    expect(pedido?.init?.method).toBe('POST')
    expect(pedido?.init?.headers).toMatchObject({ Authorization: 'Bearer jwt.a.b', apikey: 'sb_publishable_x' })
    expect(pedido?.init?.body).toBe('{"email":"a@b.c"}')
  })

  it('negação devolve o código', async () => {
    const chamar = criarChamador({
      url: 'http://x',
      chavePublica: 'k',
      obterToken: async () => 't',
      buscar: async () => json({ ok: false, codigo: 'SENHA_VAZADA' }),
    })
    expect(await chamar('definir-senha', {})).toEqual({ ok: false, codigo: 'SENHA_VAZADA' })
  })

  it('sem sessão: NAO_AUTENTICADO sem chamar a rede', async () => {
    let chamou = false
    const chamar = criarChamador({
      url: 'http://x',
      chavePublica: 'k',
      obterToken: async () => null,
      buscar: async () => {
        chamou = true
        return json({ ok: true })
      },
    })
    expect(await chamar('f', {})).toEqual({ ok: false, codigo: 'NAO_AUTENTICADO' })
    expect(chamou).toBe(false)
  })

  it('rede, corpo inválido e 401 sem corpo', async () => {
    const com = (buscar: typeof fetch) =>
      criarChamador({ url: 'http://x', chavePublica: 'k', obterToken: async () => 't', buscar })('f', {})
    expect(
      await com(async () => {
        throw new TypeError('Failed to fetch')
      }),
    ).toEqual({ ok: false, codigo: 'ERRO_INESPERADO' })
    expect(await com(async () => new Response('<html>', { status: 502 }))).toEqual({
      ok: false,
      codigo: 'ERRO_INESPERADO',
    })
    expect(await com(async () => new Response('', { status: 401 }))).toEqual({ ok: false, codigo: 'NAO_AUTENTICADO' })
    expect(await com(async () => json({ ok: false }))).toEqual({ ok: false, codigo: 'ERRO_INESPERADO' })
  })
})
