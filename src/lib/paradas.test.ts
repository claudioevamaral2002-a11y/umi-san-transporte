import { describe, expect, it } from 'vitest'
import {
  MAX_PARADAS,
  adicionar,
  mensagemDeParadas,
  paradaDoLocal,
  paraPedido,
  podeAdicionar,
  remover,
  type Parada,
} from './paradas.ts'

const a: Parada = { texto: 'Rua A, 1', place_id: 'ChIJa' }
const b: Parada = { texto: 'Rua B, 2', lat: -26.3, lng: -48.8 }
const c: Parada = { texto: 'Rua C, 3' }

describe('paradas', () => {
  it('o limite é 3', () => {
    expect(MAX_PARADAS).toBe(3)
  })
  it('adicionar acrescenta no fim sem mudar a lista original', () => {
    const lista = [a]
    expect(adicionar(lista, b)).toEqual([a, b])
    expect(lista).toEqual([a])
  })
  it('adicionar além de 3 não altera a lista', () => {
    const cheia = [a, b, c]
    expect(adicionar(cheia, { texto: 'Rua D, 4' })).toEqual(cheia)
    expect(podeAdicionar(cheia)).toBe(false)
    expect(podeAdicionar([a, b])).toBe(true)
  })
  it('remover(i) tira a parada e ignora índice fora', () => {
    expect(remover([a, b, c], 1)).toEqual([a, c])
    expect(remover([a, b], 5)).toEqual([a, b])
    expect(remover([a, b], -1)).toEqual([a, b])
  })
  it('paradaDoLocal: do Google só o place_id; do mapa só as coordenadas; texto livre sem ponto', () => {
    expect(paradaDoLocal('Posto X', { nome: 'Posto X', endereco: 'Av. 1', lat: -26.1, lng: -48.1, place_id: 'ChIJx' })).toEqual({
      texto: 'Posto X',
      place_id: 'ChIJx',
    })
    expect(paradaDoLocal('Ponto', { nome: 'Ponto', endereco: null, lat: -26.1, lng: -48.1, place_id: null })).toEqual({
      texto: 'Ponto',
      lat: -26.1,
      lng: -48.1,
    })
    expect(paradaDoLocal('Rua Z, 9', null)).toEqual({ texto: 'Rua Z, 9' })
  })
  it('paraPedido: formato de criar_pedido, texto aparado, nunca place_id junto de coordenadas', () => {
    expect(paraPedido([{ texto: '  Rua A, 1 ', place_id: 'ChIJa' }, b, c])).toEqual([
      { texto: 'Rua A, 1', place_id: 'ChIJa' },
      { texto: 'Rua B, 2', lat: -26.3, lng: -48.8 },
      { texto: 'Rua C, 3' },
    ])
    const misturada = { texto: 'Rua M', place_id: 'ChIJm', lat: 1, lng: 2 } as unknown as Parada
    expect(paraPedido([misturada])).toEqual([{ texto: 'Rua M', place_id: 'ChIJm' }])
    expect(paraPedido([])).toEqual([])
  })
  it('mensagemDeParadas: até 3, texto de 3 a 200 caracteres', () => {
    expect(mensagemDeParadas([a, b, c])).toBeNull()
    expect(mensagemDeParadas([])).toBeNull()
    expect(mensagemDeParadas([a, b, c, a])).toBe('Use no máximo 3 paradas.')
    expect(mensagemDeParadas([{ texto: 'ab' }])).toBe('Cada parada precisa de 3 a 200 caracteres.')
    expect(mensagemDeParadas([{ texto: 'x'.repeat(201) }])).toBe('Cada parada precisa de 3 a 200 caracteres.')
  })
})
