import { describe, expect, it } from 'vitest'
import { criarManipuladorEnderecos } from './google.ts'

const ok = async () => ({ ok: true })
const resp = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status })
const SESSAO = '3f1c2a9e-1d2b-4c3d-8e4f-5a6b7c8d9e0f'

describe('enderecos', () => {
  it('sugerir: repassa com token de sessão, região BR e pt-BR; devolve nome e endereço; nunca a chave', async () => {
    const pedidos: Array<{ url: string; init: RequestInit }> = []
    const buscar = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, init })
      return resp({
        suggestions: [
          {
            placePrediction: {
              placeId: 'ChIJdef',
              structuredFormat: { mainText: { text: 'Estaleiro Navegantes' }, secondaryText: { text: 'Navegantes, SC' } },
            },
          },
        ],
      })
    }) as unknown as typeof fetch
    const m = criarManipuladorEnderecos({ chave: 'CHAVE-SECRETA', buscar, registrarUso: ok })
    const r = await m({ acao: 'sugerir', texto: 'estaleiro nav', sessao: SESSAO })
    expect(r).toEqual({ ok: true, sugestoes: [{ place_id: 'ChIJdef', nome: 'Estaleiro Navegantes', endereco: 'Navegantes, SC' }] })
    expect(pedidos[0]!.url).toBe('https://places.googleapis.com/v1/places:autocomplete')
    const corpo = JSON.parse(String(pedidos[0]!.init.body))
    expect(corpo).toMatchObject({ input: 'estaleiro nav', sessionToken: SESSAO, includedRegionCodes: ['br'], languageCode: 'pt-BR' })
    expect(new Headers(pedidos[0]!.init.headers).get('X-Goog-Api-Key')).toBe('CHAVE-SECRETA')
    expect(JSON.stringify(r)).not.toContain('CHAVE-SECRETA')
  })

  it('sugerir: descarta sugestões com place_id fora do formato', async () => {
    const buscar = (async () =>
      resp({
        suggestions: [
          { placePrediction: { placeId: '../x', structuredFormat: { mainText: { text: 'X' } } } },
          { placePrediction: { placeId: 'ChIJok', structuredFormat: { mainText: { text: 'Ok' } } } },
        ],
      })) as unknown as typeof fetch
    const m = criarManipuladorEnderecos({ chave: 'K', buscar, registrarUso: ok })
    expect(await m({ acao: 'sugerir', texto: 'porto', sessao: SESSAO })).toEqual({
      ok: true,
      sugestoes: [{ place_id: 'ChIJok', nome: 'Ok', endereco: '' }],
    })
  })

  it('detalhar: pede só campos Essentials e usa o nome da sugestão', async () => {
    let cabecalhos: Headers | undefined
    let url = ''
    const buscar = (async (u: string, init: RequestInit) => {
      url = u
      cabecalhos = new Headers(init.headers)
      return resp({
        id: 'ChIJdef',
        formattedAddress: 'Av. Pref. Cirino Adolfo Cabral, 1500',
        location: { latitude: -26.8986, longitude: -48.6542 },
      })
    }) as unknown as typeof fetch
    const m = criarManipuladorEnderecos({ chave: 'K', buscar, registrarUso: ok })
    const r = await m({ acao: 'detalhar', place_id: 'ChIJdef', sessao: SESSAO, nome: 'Estaleiro Navegantes' })
    expect(cabecalhos!.get('X-Goog-FieldMask')).toBe('id,formattedAddress,location')
    expect(url).toBe(`https://places.googleapis.com/v1/places/ChIJdef?sessionToken=${SESSAO}&languageCode=pt-BR`)
    expect(r).toEqual({
      ok: true,
      local: { nome: 'Estaleiro Navegantes', endereco: 'Av. Pref. Cirino Adolfo Cabral, 1500', lat: -26.8986, lng: -48.6542, place_id: 'ChIJdef' },
    })
  })

  it('rota: km com 1 casa e minutos arredondados; sem rota devolve km null', async () => {
    let mascara: string | null = null
    const buscar = (async (_u: string, init: RequestInit) => {
      mascara = new Headers(init.headers).get('X-Goog-FieldMask')
      return resp({ routes: [{ distanceMeters: 38240, duration: '2712s' }] })
    }) as unknown as typeof fetch
    const m = criarManipuladorEnderecos({ chave: 'K', buscar, registrarUso: ok })
    expect(await m({ acao: 'rota', origem: { lat: -26.9, lng: -48.66 }, destino: { lat: -26.89, lng: -48.65 } })).toEqual({
      ok: true,
      km: 38.2,
      minutos: 45,
    })
    expect(mascara).toBe('routes.distanceMeters,routes.duration')
    const vazio = criarManipuladorEnderecos({ chave: 'K', buscar: (async () => resp({})) as unknown as typeof fetch, registrarUso: ok })
    expect(await vazio({ acao: 'rota', origem: { lat: -26.9, lng: -48.66 }, destino: { lat: -26.9, lng: -48.66 } })).toEqual({
      ok: true,
      km: null,
      minutos: null,
    })
  })

  it('rota: Google com tempo esgotado ou erro devolve km null (o pedido segue sem prévia)', async () => {
    const lento = (async (_u: string, init: RequestInit) => {
      // O sinal de tempo limite aborta a chamada.
      await new Promise((_, rejeitar) => init.signal?.addEventListener('abort', () => rejeitar(new Error('timeout'))))
      return resp({})
    }) as unknown as typeof fetch
    const m = criarManipuladorEnderecos({ chave: 'K', buscar: lento, registrarUso: ok, tempoLimiteMs: 20 })
    expect(await m({ acao: 'rota', origem: { lat: -26.9, lng: -48.66 }, destino: { lat: -26.89, lng: -48.65 } })).toEqual({
      ok: true,
      km: null,
      minutos: null,
    })
    const quebrado = criarManipuladorEnderecos({ chave: 'K', buscar: (async () => resp({}, 503)) as unknown as typeof fetch, registrarUso: ok })
    expect(await quebrado({ acao: 'rota', origem: { lat: -26.9, lng: -48.66 }, destino: { lat: -26.89, lng: -48.65 } })).toEqual({
      ok: true,
      km: null,
      minutos: null,
    })
  })

  it('valida a entrada antes de gastar chamada', async () => {
    let chamou = false
    let usou = false
    const m = criarManipuladorEnderecos({
      chave: 'K',
      buscar: (async () => {
        chamou = true
        return resp({})
      }) as unknown as typeof fetch,
      registrarUso: async () => {
        usou = true
        return { ok: true }
      },
    })
    expect(await m({ acao: 'sugerir', texto: 'ab', sessao: SESSAO })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(await m({ acao: 'sugerir', texto: 'x'.repeat(121), sessao: SESSAO })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(await m({ acao: 'sugerir', texto: 'porto', sessao: 'nao-uuid' })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(await m({ acao: 'detalhar', place_id: '../x', sessao: SESSAO, nome: 'x' })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(await m({ acao: 'detalhar', place_id: 'ChIJdef', sessao: SESSAO, nome: '' })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(await m({ acao: 'rota', origem: { lat: 40, lng: -48 }, destino: { lat: -26, lng: -48 } })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(await m({ acao: 'rota', origem: { lat: '-26', lng: -48 }, destino: { lat: -26, lng: -48 } })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(await m({ acao: 'outra' })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(chamou).toBe(false)
    expect(usou).toBe(false)
  })

  it('limite do banco, sem chave e Google fora do ar', async () => {
    const recusa = async () => ({ ok: false, codigo: 'TETO_DIARIO' })
    let chamou = false
    const m1 = criarManipuladorEnderecos({
      chave: 'K',
      buscar: (async () => {
        chamou = true
        return resp({})
      }) as unknown as typeof fetch,
      registrarUso: recusa,
    })
    expect(await m1({ acao: 'sugerir', texto: 'porto', sessao: SESSAO })).toEqual({ ok: false, codigo: 'TETO_DIARIO' })
    expect(chamou).toBe(false)
    const m2 = criarManipuladorEnderecos({ chave: null, buscar: (async () => resp({})) as unknown as typeof fetch, registrarUso: ok })
    expect(await m2({ acao: 'sugerir', texto: 'porto', sessao: SESSAO })).toEqual({ ok: false, codigo: 'MAPAS_INDISPONIVEL' })
    const m3 = criarManipuladorEnderecos({ chave: 'K', buscar: (async () => resp({ error: {} }, 500)) as unknown as typeof fetch, registrarUso: ok })
    expect(await m3({ acao: 'sugerir', texto: 'porto', sessao: SESSAO })).toEqual({ ok: false, codigo: 'MAPAS_INDISPONIVEL' })
    expect(await m3({ acao: 'detalhar', place_id: 'ChIJdef', sessao: SESSAO, nome: 'X' })).toEqual({ ok: false, codigo: 'MAPAS_INDISPONIVEL' })
  })
})
