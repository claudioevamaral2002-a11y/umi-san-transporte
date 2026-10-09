import { describe, expect, it } from 'vitest'
import {
  ALFABETO_CODIGO,
  codigoDoLink,
  formatarCodigo,
  ipDoPedido,
  montarLinkCurto,
  normalizarCodigo,
  registrarLinkCurto,
  tipoLinkValido,
} from './links.ts'
import { criarManipuladorResgate, type DependenciasResgate } from './resgate.ts'

describe('alfabeto do código', () => {
  it('31 símbolos, sem ambíguos e sem repetição', () => {
    expect(ALFABETO_CODIGO).toHaveLength(31)
    expect(new Set(ALFABETO_CODIGO).size).toBe(31)
    for (const c of '0O1IL') expect(ALFABETO_CODIGO).not.toContain(c)
  })
})

describe('normalizarCodigo', () => {
  it.each([
    ['K7M2QX9PRT', 'K7M2QX9PRT'],
    ['k7m2-qx9prt', 'K7M2QX9PRT'],
    [' K7M2 QX9PRT ', 'K7M2QX9PRT'],
    ['K7M2QX9PR', null],
    ['K7M2QX9PRTA', null],
    ['K7M2QX9PR0', null],
    ['K7M2QX9PRO', null],
    ['K7M2QX9PRI', null],
    ['K7M2QX9PRL', null],
    ['K7M2QX9PR1', null],
    ['', null],
    ['../etc/pass', null],
  ])('%j -> %j', (bruto, esperado) => {
    expect(normalizarCodigo(bruto)).toBe(esperado)
  })

  it('recusa o que não é texto ou é enorme', () => {
    expect(normalizarCodigo(undefined)).toBeNull()
    expect(normalizarCodigo(123)).toBeNull()
    expect(normalizarCodigo('K'.repeat(1000))).toBeNull()
  })
})

describe('montarLinkCurto', () => {
  it('origem + /c/ + código sem hífen', () => {
    expect(montarLinkCurto('https://umi-san-transporte.pages.dev', 'k7m2-qx9prt')).toBe(
      'https://umi-san-transporte.pages.dev/c/K7M2QX9PRT',
    )
    expect(montarLinkCurto('http://127.0.0.1:8788/', 'K7M2QX9PRT')).toBe('http://127.0.0.1:8788/c/K7M2QX9PRT')
  })

  it('o link é curto (cabe numa linha de WhatsApp) e não carrega token do Auth', () => {
    const link = montarLinkCurto('https://umi-san-transporte.pages.dev', 'K7M2QX9PRT')!
    expect(link.length).toBeLessThan(60)
    expect(link).not.toMatch(/token|verify|type=|redirect/)
  })

  it('recusa origem ou código inválidos', () => {
    expect(montarLinkCurto('javascript:alert(1)', 'K7M2QX9PRT')).toBeNull()
    expect(montarLinkCurto('não é url', 'K7M2QX9PRT')).toBeNull()
    expect(montarLinkCurto('https://a.b', 'curto')).toBeNull()
  })

  it('ida e volta: codigoDoLink e formatarCodigo', () => {
    expect(codigoDoLink('https://a.b/c/K7M2QX9PRT')).toBe('K7M2QX9PRT')
    expect(codigoDoLink('https://a.b/c/K7M2-QX9PRT/')).toBe('K7M2QX9PRT')
    expect(codigoDoLink('https://a.b/definir-senha')).toBeNull()
    expect(codigoDoLink('lixo')).toBeNull()
    expect(formatarCodigo('K7M2QX9PRT')).toBe('K7M2-QX9PRT')
  })
})

describe('tipoLinkValido e ipDoPedido', () => {
  it('só invite e recovery', () => {
    expect(tipoLinkValido('invite')).toBe(true)
    expect(tipoLinkValido('recovery')).toBe(true)
    expect(tipoLinkValido('magiclink')).toBe(false)
    expect(tipoLinkValido(undefined)).toBe(false)
  })

  it('prefere cf-connecting-ip; senão o primeiro do X-Forwarded-For', () => {
    expect(ipDoPedido(new Headers({ 'cf-connecting-ip': '203.0.113.1', 'x-forwarded-for': '1.1.1.1' }))).toBe('203.0.113.1')
    expect(ipDoPedido(new Headers({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe('198.51.100.2')
    expect(ipDoPedido(new Headers())).toBe('desconhecido')
  })
})

describe('registrarLinkCurto', () => {
  const gerado = {
    data: {
      properties: { hashed_token: 'hash-falso-de-teste', action_link: 'https://x.supabase.co/auth/v1/verify?token=abc' },
      user: { id: 'u-1' },
    },
    error: null,
  }

  it('guarda o hashed_token pela RPC de sistema e devolve o link curto (nunca o action_link)', async () => {
    const chamadas: Array<[string, Record<string, unknown>]> = []
    const servico = {
      rpc: async (nome: string, args: Record<string, unknown>) => {
        chamadas.push([nome, args])
        return { data: { ok: true, codigo_link: 'K7M2QX9PRT' }, error: null }
      },
    }
    const r = await registrarLinkCurto(servico, gerado, 'invite', 'https://app.exemplo')
    expect(r).toEqual({ ok: true, link: 'https://app.exemplo/c/K7M2QX9PRT' })
    expect(chamadas).toEqual([
      ['sistema_criar_link_curto', { p_token_hash: 'hash-falso-de-teste', p_tipo: 'invite', p_usuario: 'u-1' }],
    ])
    expect(JSON.stringify(r)).not.toContain('verify')
  })

  it('falha do generateLink ou da RPC não devolve link', async () => {
    const ok = { rpc: async () => ({ data: { ok: true, codigo_link: 'K7M2QX9PRT' }, error: null }) }
    expect(await registrarLinkCurto(ok, { data: null, error: new Error('x') }, 'recovery', 'https://a.b')).toEqual({
      ok: false,
      etapa: 'gerar',
    })
    expect(
      await registrarLinkCurto(ok, { data: { properties: { hashed_token: null }, user: { id: 'u' } } }, 'recovery', 'https://a.b'),
    ).toEqual({ ok: false, etapa: 'gerar' })
    const recusa = { rpc: async () => ({ data: { ok: false, codigo: 'CAMPOS_INVALIDOS' }, error: null }) }
    expect(await registrarLinkCurto(recusa, gerado, 'recovery', 'https://a.b')).toEqual({ ok: false, etapa: 'registrar' })
    const erro = { rpc: async () => ({ data: null, error: { code: 'x' } }) }
    expect(await registrarLinkCurto(erro, gerado, 'recovery', 'https://a.b')).toEqual({ ok: false, etapa: 'registrar' })
  })
})

describe('resgatar-link (manipulador)', () => {
  const ORIGEM = 'https://app.exemplo'

  function montar(opcoes: { resgate?: unknown; verify?: { session: unknown } | null; erroVerify?: unknown } = {}) {
    const rpcs: Array<[string, Record<string, unknown>]> = []
    const verificados: unknown[] = []
    const deps: DependenciasResgate = {
      origens: () => ORIGEM,
      clientes: () => ({
        servico: {
          rpc: async (nome: string, args: Record<string, unknown>) => {
            rpcs.push([nome, args])
            if (nome === 'sistema_resgatar_link') {
              return { data: opcoes.resgate ?? { ok: true, token_hash: 'hash-abc', tipo: 'invite' }, error: null }
            }
            return { data: { ok: true }, error: null }
          },
        },
        publico: {
          auth: {
            verifyOtp: async (params: unknown) => {
              verificados.push(params)
              return {
                data: opcoes.verify === undefined ? { session: { access_token: 'at', refresh_token: 'rt' } } : opcoes.verify,
                error: opcoes.erroVerify ?? null,
              } as never
            },
          },
        },
      }),
      limitador: { permitir: () => true },
    }
    return { manipular: criarManipuladorResgate(deps), rpcs, verificados }
  }

  const post = (corpo: unknown, cabecalhos: Record<string, string> = {}) =>
    new Request('https://f/resgatar-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGEM, 'x-forwarded-for': '203.0.113.5', ...cabecalhos },
      body: JSON.stringify(corpo),
    })

  it('GET (pré-visualização/pré-carregamento) não toca em nada: 405', async () => {
    const { manipular, rpcs, verificados } = montar()
    const r = await manipular(new Request('https://f/resgatar-link?codigo=K7M2QX9PRT', { method: 'GET' }))
    expect(r.status).toBe(405)
    expect(rpcs).toEqual([])
    expect(verificados).toEqual([])
  })

  it('POST válido: resgata no banco, verifyOtp com token_hash/tipo e devolve a sessão (no-store)', async () => {
    const { manipular, rpcs, verificados } = montar()
    const r = await manipular(post({ codigo: 'k7m2-qx9prt' }))
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGEM)
    expect(await r.json()).toEqual({ ok: true, access_token: 'at', refresh_token: 'rt' })
    expect(rpcs).toEqual([['sistema_resgatar_link', { p_codigo: 'K7M2QX9PRT', p_ip: '203.0.113.5' }]])
    expect(verificados).toEqual([{ token_hash: 'hash-abc', type: 'invite' }])
  })

  it('código usado/expirado: devolve o código do banco e não chama verifyOtp', async () => {
    const { manipular, verificados } = montar({ resgate: { ok: false, codigo: 'EXPIRADO' } })
    expect(await (await manipular(post({ codigo: 'K7M2QX9PRT' }))).json()).toEqual({ ok: false, codigo: 'EXPIRADO' })
    expect(verificados).toEqual([])
  })

  it('verifyOtp recusado (token invalidado no Auth): EXPIRADO e registro de sistema', async () => {
    const { manipular, rpcs } = montar({ verify: { session: null }, erroVerify: { status: 403, code: 'otp_expired' } })
    expect(await (await manipular(post({ codigo: 'K7M2QX9PRT' }))).json()).toEqual({ ok: false, codigo: 'EXPIRADO' })
    expect(rpcs.map(([n]) => n)).toEqual(['sistema_resgatar_link', 'sistema_registrar'])
  })

  it('origem fora da lista: 403; corpo inválido: CAMPOS_INVALIDOS; limite em memória: LIMITE_EXCEDIDO', async () => {
    const { manipular, rpcs } = montar()
    expect((await manipular(post({ codigo: 'K7M2QX9PRT' }, { Origin: 'https://mau.exemplo' }))).status).toBe(403)
    const invalido = await manipular(
      new Request('https://f', { method: 'POST', headers: { Origin: ORIGEM }, body: 'não é json' }),
    )
    expect(await invalido.json()).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(rpcs).toEqual([])

    const negar = criarManipuladorResgate({
      origens: () => ORIGEM,
      clientes: () => {
        throw new Error('não deveria chamar')
      },
      limitador: { permitir: () => false },
    })
    expect(await (await negar(post({ codigo: 'K7M2QX9PRT' }))).json()).toEqual({ ok: false, codigo: 'LIMITE_EXCEDIDO' })
  })

  it('código malformado ainda passa pelo banco (conta no limite por IP)', async () => {
    const { manipular, rpcs } = montar({ resgate: { ok: false, codigo: 'NAO_ENCONTRADO' } })
    expect(await (await manipular(post({ codigo: 'x' }))).json()).toEqual({ ok: false, codigo: 'NAO_ENCONTRADO' })
    expect(rpcs).toEqual([['sistema_resgatar_link', { p_codigo: 'x', p_ip: '203.0.113.5' }]])
  })

  it('OPTIONS devolve o CORS da origem permitida', async () => {
    const { manipular } = montar()
    const r = await manipular(new Request('https://f', { method: 'OPTIONS', headers: { Origin: ORIGEM } }))
    expect(r.status).toBe(204)
    expect(r.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
  })
})
