import { describe, expect, it } from 'vitest'
import {
  alvoDaViagem,
  aplicarPosicao,
  chegou,
  comoPosicao,
  criarAmostrador,
  distanciaM,
  estadoDoSinal,
  interpolar,
  minutosAte,
  precisaRecalcularEta,
} from './rastreio.ts'

const PORTO = { lat: -26.9, lng: -48.66 }
/** ~11 m para o norte por 0,0001°. */
const norte = (graus: number) => ({ lat: PORTO.lat + graus, lng: PORTO.lng, precisao: 10 })

describe('distanciaM', () => {
  it('bate com o banco: 0,003° de latitude ≈ 333 m', () => {
    expect(distanciaM(PORTO, { lat: -26.897, lng: -48.66 })).toBeCloseTo(333.6, 0)
    expect(distanciaM(PORTO, PORTO)).toBe(0)
  })
})

describe('criarAmostrador', () => {
  it('primeira leitura vai; depois, a cada 5 s ou ao andar 50 m', () => {
    const a = criarAmostrador()
    expect(a.deveEnviar(norte(0), 0)).toBe(true)
    expect(a.deveEnviar(norte(0.0001), 1_000)).toBe(false) // 11 m em 1 s
    expect(a.deveEnviar(norte(0.0005), 2_000)).toBe(true) // 55 m
    expect(a.deveEnviar(norte(0.0006), 4_000)).toBe(false)
    expect(a.deveEnviar(norte(0.0007), 7_000)).toBe(true) // 5 s depois do último envio
  })

  it('descarta leitura com precisão pior que 100 m ou coordenada inválida', () => {
    const a = criarAmostrador()
    expect(a.deveEnviar({ ...norte(0), precisao: 150 }, 0)).toBe(false)
    expect(a.deveEnviar({ lat: Number.NaN, lng: 1, precisao: 5 }, 0)).toBe(false)
    expect(a.deveEnviar(norte(0), 0)).toBe(true)
  })

  it('parado há mais de 60 s: só um sinal de vida a cada 30 s', () => {
    const a = criarAmostrador()
    expect(a.deveEnviar(norte(0), 0)).toBe(true)
    let enviados = 0
    for (let t = 1_000; t <= 60_000; t += 1_000) if (a.deveEnviar(norte(0), t)) enviados++
    expect(enviados).toBe(12) // a cada 5 s no primeiro minuto
    expect(a.deveEnviar(norte(0), 65_000)).toBe(false)
    expect(a.deveEnviar(norte(0), 90_000)).toBe(true)
    expect(a.deveEnviar(norte(0), 110_000)).toBe(false)
    expect(a.deveEnviar(norte(0.001), 111_000)).toBe(true) // voltou a andar (110 m)
  })
})

describe('cliente: posições', () => {
  const p = (seq: number) => ({ ...PORTO, seq, recebidaEm: seq })
  it('a última vence: seq antigo ou repetido é ignorado', () => {
    expect(aplicarPosicao(null, p(3))).toEqual(p(3))
    expect(aplicarPosicao(p(3), p(2))).toEqual(p(3))
    expect(aplicarPosicao(p(3), p(3))).toEqual(p(3))
    expect(aplicarPosicao(p(3), p(4))).toEqual(p(4))
  })

  it('payload do canal: só posição com coordenadas válidas', () => {
    expect(comoPosicao({ lat: -26.9, lng: -48.66, seq: 7, rumo: 90, eta: '2026-10-18T12:00:00Z' }, 5)).toEqual({
      lat: -26.9,
      lng: -48.66,
      seq: 7,
      recebidaEm: 5,
      rumo: 90,
      eta: '2026-10-18T12:00:00Z',
    })
    expect(comoPosicao({ lat: '1', lng: 2 }, 0)).toBeNull()
    expect(comoPosicao({ lat: 91, lng: 2 }, 0)).toBeNull()
    expect(comoPosicao(null, 0)).toBeNull()
    expect(comoPosicao({ lat: 1, lng: 2, eta: 'ontem' }, 0)).toMatchObject({ seq: 0, eta: null, rumo: null })
  })

  it('interpola entre dois pontos (limitado a 0..1)', () => {
    const de = { lat: 0, lng: 0 }
    const para = { lat: 10, lng: 20 }
    expect(interpolar(de, para, 0.5)).toEqual({ lat: 5, lng: 10 })
    expect(interpolar(de, para, -1)).toEqual(de)
    expect(interpolar(de, para, 2)).toEqual(para)
  })

  it('sinal: aguardando, ao vivo até 20 s, atrasado até 60 s, perdido depois', () => {
    expect(estadoDoSinal(null, 0)).toBe('aguardando')
    expect(estadoDoSinal(0, 20_000)).toBe('ao_vivo')
    expect(estadoDoSinal(0, 20_001)).toBe('atrasado')
    expect(estadoDoSinal(0, 60_000)).toBe('atrasado')
    expect(estadoDoSinal(0, 60_001)).toBe('perdido')
  })
})

describe('chegada prevista', () => {
  it('recalcula na saída, ao trocar o alvo e a cada 10 min', () => {
    expect(precisaRecalcularEta(null, 'destino', 0)).toBe(true)
    expect(precisaRecalcularEta({ em: 0, destino: 'destino' }, 'destino', 9 * 60_000)).toBe(false)
    expect(precisaRecalcularEta({ em: 0, destino: 'destino' }, 'destino', 10 * 60_000)).toBe(true)
    expect(precisaRecalcularEta({ em: 0, destino: 'destino' }, 'origem', 60_000)).toBe(true)
  })

  it('ida e volta: depois de chegar ao destino, o alvo é a origem', () => {
    expect(alvoDaViagem(false, true)).toBe('destino')
    expect(alvoDaViagem(true, false)).toBe('destino')
    expect(alvoDaViagem(true, true)).toBe('origem')
    expect(chegou(PORTO, { lat: -26.9013, lng: -48.66 })).toBe(true) // ~145 m
    expect(chegou(PORTO, { lat: -26.902, lng: -48.66 })).toBe(false) // ~222 m
    expect(chegou(PORTO, null)).toBe(false)
  })

  it('minutos até a chegada descontam o tempo que passou', () => {
    const agora = Date.parse('2026-10-18T12:00:00Z')
    expect(minutosAte('2026-10-18T12:14:40Z', agora)).toBe(15)
    expect(minutosAte('2026-10-18T11:50:00Z', agora)).toBe(0)
    expect(minutosAte(null, agora)).toBeNull()
    expect(minutosAte('ontem', agora)).toBeNull()
  })
})
