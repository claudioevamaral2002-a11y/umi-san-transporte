import { describe, expect, it } from 'vitest'
import { comParadaNova, mudarCampo, semParada, VAZIO, type CamposDoPedido as Campos } from './camposDoPedido.ts'

const local = (nome: string, place_id: string) => ({ texto: nome, local: { nome, endereco: null, lat: null, lng: null, place_id } })
const inicio: Campos = { origem: VAZIO, paradas: [], ids: [], destino: VAZIO, escolhendo: false }

describe('mudarCampo (v2.2: cada campo muda sozinho, a partir do valor atual)', () => {
  it('a origem que resolve tarde não apaga o Para digitado nesse meio-tempo', () => {
    // O cliente escolhe a origem (texto, sem local), digita o Para, e só então a origem chega com o local.
    let c = mudarCampo(inicio, 'origem', { texto: 'Estaleiro Navship', local: null })
    c = mudarCampo(c, 'destino', { texto: 'Porto de Itajaí', local: null })
    c = mudarCampo(c, 'origem', local('Estaleiro Navship', 'ChIJnav'))
    expect(c.destino).toEqual({ texto: 'Porto de Itajaí', local: null })
    expect(c.origem.local?.place_id).toBe('ChIJnav')
    expect(c.escolhendo).toBe(false)
  })

  it('a parada muda pela identidade; a que já foi removida não muda nada', () => {
    let c = comParadaNova(comParadaNova(inicio, 7), 8)
    c = mudarCampo(c, { parada: 8 }, local('Estaleiro Detroit', 'ChIJdet'))
    expect(c.paradas[1]!.texto).toBe('Estaleiro Detroit')
    expect(c.paradas[0]).toEqual(VAZIO)
    c = semParada(c, 0)
    expect(c.ids).toEqual([8])
    expect(mudarCampo(c, { parada: 7 }, local('X', 'x'))).toBe(c)
    c = mudarCampo(c, 'destino', { texto: 'Porto', local: null })
    c = mudarCampo(c, { parada: 8 }, local('Estaleiro Navship', 'ChIJnav'))
    expect(c.destino.texto).toBe('Porto')
  })

  it('com todos os pontos, passa à escolha da categoria; uma parada nova volta aos endereços', () => {
    let c = mudarCampo(inicio, 'origem', local('Estaleiro Navegantes', 'ChIJdef'))
    expect(c.escolhendo).toBe(false)
    c = mudarCampo(c, 'destino', local('Porto de Itajaí', 'ChIJpor'))
    expect(c.escolhendo).toBe(true)
    c = comParadaNova(c, 1)
    expect(c.escolhendo).toBe(false)
    expect(comParadaNova(comParadaNova(comParadaNova(c, 2), 3), 4).paradas).toHaveLength(3)
  })

  it('depois de voltar aos endereços, uma resposta de um campo que já tinha ponto não reabre a escolha', () => {
    let c = mudarCampo(inicio, 'origem', local('Estaleiro Navegantes', 'ChIJdef'))
    c = mudarCampo(c, 'destino', local('Porto de Itajaí', 'ChIJpor'))
    c = { ...c, escolhendo: false }
    c = mudarCampo(c, 'origem', local('Estaleiro Navship', 'ChIJnav'))
    expect(c.escolhendo).toBe(false)
    // Um campo que perde o ponto (texto digitado) e ganha de novo leva à escolha.
    c = mudarCampo(c, 'destino', { texto: 'Detroit', local: null })
    c = mudarCampo(c, 'destino', local('Estaleiro Detroit', 'ChIJdet'))
    expect(c.escolhendo).toBe(true)
  })
})
