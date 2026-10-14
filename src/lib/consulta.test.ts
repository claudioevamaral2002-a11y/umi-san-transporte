import { describe, expect, it } from 'vitest'
import { geracaoDaMemoria, guardarNaMemoria, lerDaMemoria, limparConsultas } from './consulta.ts'

describe('memória das consultas', () => {
  it('guarda e lê pela chave', () => {
    limparConsultas()
    guardarNaMemoria('pedidos-abertos', [1, 2], geracaoDaMemoria())
    expect(lerDaMemoria('pedidos-abertos')).toEqual({ tem: true, dados: [1, 2] })
  })

  it('resposta de uma busca iniciada antes de sair da conta não entra na memória da conta seguinte', () => {
    limparConsultas()
    const daContaA = geracaoDaMemoria() // a busca da conta A começa
    limparConsultas() // A sai e B entra
    guardarNaMemoria('pedidos-abertos', ['dado de A'], daContaA) // a resposta de A chega atrasada
    expect(lerDaMemoria('pedidos-abertos')).toEqual({ tem: false, dados: undefined })
  })
})
