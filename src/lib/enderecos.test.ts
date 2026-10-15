import { describe, expect, it } from 'vitest'
import { chaveDaRota, criarSessaoDeBusca, formatarRota, juntarSugestoes, type Local } from './enderecos.ts'

describe('sessão de busca', () => {
  it('a mesma sessão usa o mesmo token até encerrar; depois, token novo', () => {
    let n = 0
    const s = criarSessaoDeBusca(() => `t${++n}`)
    expect(s.token()).toBe('t1')
    expect(s.token()).toBe('t1')
    s.encerrar()
    expect(s.token()).toBe('t2')
  })

  it('busca com o token da sessão; depois de encerrar (sessão abandonada), a próxima busca usa token novo', async () => {
    let n = 0
    const tokens: string[] = []
    const s = criarSessaoDeBusca(
      () => `t${++n}`,
      async (_texto, token) => {
        tokens.push(token)
        return []
      },
    )
    await s.buscar('porto')
    await s.buscar('porto de')
    s.encerrar()
    await s.buscar('marina')
    expect(tokens).toEqual(['t1', 't1', 't2'])
  })

  it('última resposta vence: a resposta de uma digitação antiga vira null', async () => {
    const respostas: Array<(v: unknown) => void> = []
    const s = criarSessaoDeBusca(() => 't', (() => new Promise((r) => respostas.push(r))) as never)
    const antiga = s.buscar('estal')
    const nova = s.buscar('estaleiro')
    respostas[1]!([{ place_id: 'b', nome: 'B', endereco: '' }])
    respostas[0]!([{ place_id: 'a', nome: 'A', endereco: '' }])
    expect(await antiga).toBeNull()
    expect(await nova).toEqual([{ place_id: 'b', nome: 'B', endereco: '' }])
  })

  it('encerrar também descarta a resposta que ainda estava a caminho', async () => {
    let resolver: (v: unknown) => void = () => undefined
    const s = criarSessaoDeBusca(() => 't', (() => new Promise((r) => (resolver = r))) as never)
    const pendente = s.buscar('porto')
    s.encerrar()
    resolver([{ place_id: 'a', nome: 'A', endereco: '' }])
    expect(await pendente).toBeNull()
  })
})

describe('juntarSugestoes', () => {
  const estaleiro: Local = { nome: 'Estaleiro Navegantes', endereco: 'Av. X', lat: -26.89, lng: -48.65, place_id: 'ChIJdef' }
  const marina: Local = { nome: 'Marina, rampa 2', endereco: null, lat: -26.91, lng: -48.65, place_id: null }

  it('locais da empresa primeiro; o Google sem repetir o que já veio da empresa', () => {
    expect(
      juntarSugestoes(
        [estaleiro, marina],
        [
          { place_id: 'ChIJdef', nome: 'Estaleiro Navegantes', endereco: 'Navegantes, SC' },
          { place_id: 'ChIJnew', nome: 'Estaleiro Navship', endereco: 'Navegantes, SC' },
        ],
      ),
    ).toEqual([
      { ...estaleiro, daEmpresa: true },
      { ...marina, daEmpresa: true },
      { place_id: 'ChIJnew', nome: 'Estaleiro Navship', endereco: 'Navegantes, SC', daEmpresa: false },
    ])
  })
})

describe('chaveDaRota', () => {
  it('a mesma dupla de pontos dá a mesma chave (a rota é calculada uma vez por par)', () => {
    const a: Local = { nome: 'A', endereco: null, lat: -26.9, lng: -48.66, place_id: 'ChIJa' }
    const b: Local = { nome: 'B', endereco: null, lat: -26.89123456, lng: -48.65, place_id: null }
    expect(chaveDaRota(a, b)).toBe(chaveDaRota({ ...a, nome: 'Outro nome' }, { ...b }))
    expect(chaveDaRota(a, b)).not.toBe(chaveDaRota(b, a))
    expect(chaveDaRota(a, null)).toBeNull()
  })
})

describe('formatarRota', () => {
  it('km e minutos legíveis', () => {
    expect(formatarRota(38.2, 45)).toEqual({ km: '38 km pela rota', tempo: 'cerca de 45 min' })
    expect(formatarRota(120.4, 65)).toEqual({ km: '120 km pela rota', tempo: 'cerca de 1 h 5 min' })
    expect(formatarRota(0.4, 2)).toEqual({ km: 'menos de 1 km', tempo: 'cerca de 2 min' })
    expect(formatarRota(38.6, null)).toEqual({ km: '39 km pela rota', tempo: null })
  })
})
