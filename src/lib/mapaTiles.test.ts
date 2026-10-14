import { describe, expect, it } from 'vitest'
import { criarSessaoTiles } from './mapaTiles.ts'

describe('criarSessaoTiles', () => {
  it('cria a sessão de blocos (roadmap, pt-BR, BR) e monta a URL dos blocos com sessão e chave', async () => {
    const pedidos: Array<{ url: string; init?: RequestInit }> = []
    const buscar = (async (url: string, init?: RequestInit) => {
      pedidos.push({ url, init })
      return new Response(JSON.stringify({ session: 's1', expiry: '9999999999' }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await criarSessaoTiles('CHAVE', buscar)
    expect(pedidos[0]!.url).toBe('https://tile.googleapis.com/v1/createSession?key=CHAVE')
    expect(pedidos[0]!.init?.method).toBe('POST')
    expect(JSON.parse(String(pedidos[0]!.init?.body))).toEqual({ mapType: 'roadmap', language: 'pt-BR', region: 'BR' })
    expect(r).toEqual({ session: 's1', urlTile: 'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=s1&key=CHAVE' })
  })

  it('sem chave, com erro ou com sessão estranha: null (o mapa fica indisponível)', async () => {
    const ok = (async () => new Response(JSON.stringify({ session: 's1' }), { status: 200 })) as unknown as typeof fetch
    expect(await criarSessaoTiles('', ok)).toBeNull()
    const erro = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch
    expect(await criarSessaoTiles('CHAVE', erro)).toBeNull()
    const rede = (async () => {
      throw new Error('rede')
    }) as unknown as typeof fetch
    expect(await criarSessaoTiles('CHAVE', rede)).toBeNull()
    const estranha = (async () => new Response(JSON.stringify({ session: 'x&y=1' }), { status: 200 })) as unknown as typeof fetch
    expect(await criarSessaoTiles('CHAVE', estranha)).toBeNull()
  })
})
