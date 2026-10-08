import { describe, expect, it, vi } from 'vitest'
import { cabecalhosCors, escolherOrigem, origemPermitida, origensPermitidas } from './cors.ts'
import { senhaVazada, sha1Hex, sufixoPresente, VerificacaoIndisponivel } from './hibp.ts'
import { criarLimitador, extrairBearer, lerJson } from './respostas.ts'
import { logErro } from './log.ts'
import { normalizarSenha, validarForcaSenha } from './senha.ts'

describe('validarForcaSenha', () => {
  it.each([
    ['Abcdefgh1j', null],
    ['Senha-Forte-2026', null],
    ['Abcdefgh1', 'SENHA_FRACA'],
    ['abcdefghij1', 'SENHA_FRACA'],
    ['ABCDEFGHIJ1', 'SENHA_FRACA'],
    ['Abcdefghijk', 'SENHA_FRACA'],
    ['Aa1' + 'x'.repeat(70), 'SENHA_LONGA'],
    ['Aa1' + 'x'.repeat(69), null],
    ['Aa1' + 'é'.repeat(35), 'SENHA_LONGA'],
    ['', 'SENHA_FRACA'],
  ])('%s -> %s', (senha, esperado) => {
    expect(validarForcaSenha(senha)).toBe(esperado)
  })

  it('recusa o que não é texto', () => {
    expect(validarForcaSenha(123456789012)).toBe('SENHA_FRACA')
    expect(validarForcaSenha(undefined)).toBe('SENHA_FRACA')
  })
})

describe('normalização', () => {
  it('NFC: forma decomposta e composta viram a mesma senha', () => {
    expect(normalizarSenha('Café-Forte-1')).toBe('Café-Forte-1')
  })
})

describe('hibp', () => {
  it('SHA-1 em hexadecimal maiúsculo', async () => {
    expect(await sha1Hex('password')).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8')
  })

  it('compara o sufixo e ignora padding com contagem 0', () => {
    const corpo = 'AAAA:3\r\n0018A45C4D1DEF81644B54AB7F969B88D65:0\r\nFFFF:12'
    expect(sufixoPresente(corpo, 'ffff')).toBe(true)
    expect(sufixoPresente(corpo, '0018A45C4D1DEF81644B54AB7F969B88D65')).toBe(false)
    expect(sufixoPresente(corpo, 'BBBB')).toBe(false)
  })

  it('consulta só os 5 primeiros caracteres, com Add-Padding', async () => {
    let url = ''
    let cabecalhos: HeadersInit | undefined
    const buscar = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      url = String(entrada)
      cabecalhos = init?.headers
      return new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:9\r\nABC:0')
    }) as typeof fetch
    expect(await senhaVazada('password', buscar)).toBe(true)
    expect(url).toBe('https://api.pwnedpasswords.com/range/5BAA6')
    expect(cabecalhos).toEqual({ 'Add-Padding': 'true' })
  })

  it('senha ausente da lista não é vazada', async () => {
    const buscar = (async () => new Response('ABC:2')) as unknown as typeof fetch
    expect(await senhaVazada('password', buscar)).toBe(false)
  })

  it('falha fechada: status de erro, rede e tempo esgotado', async () => {
    const erro = (async () => new Response('x', { status: 503 })) as unknown as typeof fetch
    const rede = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    const lento = ((_: unknown, init?: RequestInit) =>
      new Promise((_resolve, rejeitar) => {
        init?.signal?.addEventListener('abort', () => rejeitar(new Error('abortado')))
      })) as unknown as typeof fetch
    await expect(senhaVazada('password', erro)).rejects.toBeInstanceOf(VerificacaoIndisponivel)
    await expect(senhaVazada('password', rede)).rejects.toBeInstanceOf(VerificacaoIndisponivel)
    await expect(senhaVazada('password', lento, 20)).rejects.toBeInstanceOf(VerificacaoIndisponivel)
  })
})

describe('cors', () => {
  const lista = origensPermitidas(' http://127.0.0.1:8788/, https://app.exemplo.dev ,')

  it('normaliza a lista', () => {
    expect(lista).toEqual(['http://127.0.0.1:8788', 'https://app.exemplo.dev'])
    expect(origensPermitidas(undefined)).toEqual([])
  })

  it('só origens listadas recebem cabeçalhos', () => {
    expect(origemPermitida('https://app.exemplo.dev', lista)).toBe(true)
    expect(origemPermitida('https://mau.dev', lista)).toBe(false)
    expect(origemPermitida(null, lista)).toBe(false)
    expect(cabecalhosCors('https://mau.dev', lista)).toEqual({})
    expect(cabecalhosCors('https://app.exemplo.dev', lista)['Access-Control-Allow-Origin']).toBe('https://app.exemplo.dev')
  })

  it('origem de links: a do pedido se permitida, senão a primeira', () => {
    expect(escolherOrigem('https://app.exemplo.dev', lista)).toBe('https://app.exemplo.dev')
    expect(escolherOrigem('https://mau.dev', lista)).toBe('http://127.0.0.1:8788')
    expect(escolherOrigem(null, lista)).toBe('http://127.0.0.1:8788')
    expect(escolherOrigem(null, [])).toBeNull()
  })
})

describe('requisição', () => {
  const pedido = (corpo: string, extra: Record<string, string> = {}) =>
    new Request('http://x/f', { method: 'POST', body: corpo, headers: extra })

  it('lê só objeto JSON', async () => {
    expect(await lerJson(pedido('{"a":1}'))).toEqual({ a: 1 })
    expect(await lerJson(pedido('[1]'))).toBeNull()
    expect(await lerJson(pedido('"x"'))).toBeNull()
    expect(await lerJson(pedido('{ruim'))).toBeNull()
    expect(await lerJson(pedido(''))).toBeNull()
    expect(await lerJson(pedido(JSON.stringify({ a: 'x'.repeat(11_000) })))).toBeNull()
  })

  const emPartes = (partes: Uint8Array[], cabecalhos: Record<string, string> = {}) =>
    new Request('http://x/f', {
      method: 'POST',
      headers: cabecalhos,
      duplex: 'half',
      body: new ReadableStream({
        start(controle) {
          for (const p of partes) controle.enqueue(p)
          controle.close()
        },
      }),
    } as RequestInit)
  const bytes = (t: string) => new TextEncoder().encode(t)

  it('corpo em fluxo, sem Content-Length: lê em partes e aborta ao passar do limite', async () => {
    expect(await lerJson(emPartes([bytes('{"a":'), bytes('1}')]))).toEqual({ a: 1 })
    const grande = [bytes('{"a":"'), bytes('x'.repeat(6000)), bytes('x'.repeat(6000)), bytes('"}')]
    expect(await lerJson(emPartes(grande))).toBeNull()
  })

  it('o limite conta bytes, não caracteres (multibyte)', async () => {
    const quase = JSON.stringify({ a: 'é'.repeat(4000) }) // ~8 KB em bytes, 4 mil caracteres
    expect(new TextEncoder().encode(quase).length).toBeLessThan(10_000)
    expect(await lerJson(emPartes([bytes(quase)]))).not.toBeNull()
    const passou = JSON.stringify({ a: 'é'.repeat(5100) }) // < 10 mil caracteres, > 10 mil bytes
    expect(passou.length).toBeLessThan(10_000)
    expect(await lerJson(emPartes([bytes(passou)]))).toBeNull()
  })

  it('Content-Length não numérico é recusado', async () => {
    expect(await lerJson(emPartes([bytes('{}')], { 'content-length': 'abc' }))).toBeNull()
    expect(await lerJson(emPartes([bytes('{}')], { 'content-length': '-1' }))).toBeNull()
  })

  it('UTF-8 inválido é recusado', async () => {
    expect(await lerJson(emPartes([new Uint8Array([0x7b, 0xff, 0x7d])]))).toBeNull()
  })

  it('extrai o Bearer', () => {
    expect(extrairBearer(pedido('{}', { authorization: 'Bearer a.b-c_d' }))).toBe('a.b-c_d')
    expect(extrairBearer(pedido('{}', { authorization: 'Basic abc' }))).toBeNull()
    expect(extrairBearer(pedido('{}'))).toBeNull()
  })

  it('limitador por chave com janela deslizante', () => {
    let agora = 0
    const limite = criarLimitador(2, 1000, () => agora)
    expect(limite.permitir('a')).toBe(true)
    expect(limite.permitir('a')).toBe(true)
    expect(limite.permitir('a')).toBe(false)
    expect(limite.permitir('b')).toBe(true)
    agora = 1001
    expect(limite.permitir('a')).toBe(true)
  })
})

describe('log seguro', () => {
  it('registra só função, etapa e nome/status/código do erro', () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    logErro('definir-senha', 'gravar', {
      name: 'AuthApiError',
      status: 422,
      code: 'weak_password',
      message: 'senha SegredoSuperSecreto123 e link https://x/y?token=abc',
    })
    logErro('convidar', 'excecao', new Error('Bearer eyJ.abc.def'))
    const saida = espiao.mock.calls.map((a) => String(a[0])).join(' ')
    espiao.mockRestore()
    expect(saida).toContain('weak_password')
    expect(saida).toContain('AuthApiError')
    expect(saida).not.toContain('SegredoSuperSecreto')
    expect(saida).not.toContain('token=')
    expect(saida).not.toContain('eyJ')
  })
})
