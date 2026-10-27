import { describe, expect, it } from 'vitest'
import { destinoNoAppNovo } from './destinoPedido.ts'

const r = (status: string, acoes: Record<string, boolean> = {}, modalidade = 'VEICULO_PROPRIO') =>
  ({ pedido: { id: 'p1', status, modalidade }, acoes }) as unknown as Parameters<typeof destinoNoAppNovo>[1]

describe('destinoNoAppNovo', () => {
  it('cliente: da solicitada à concluída, e também cancelada e expirada, abrem a corrida nova; recusada e reprovada, o detalhe', () => {
    for (const s of ['SOLICITADA', 'ORCADA', 'AGENDADA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA', 'EXPIRADA']) {
      expect(destinoNoAppNovo('CLIENTE', r(s))).toBe('/corrida/p1')
    }
    for (const s of ['RECUSADA', 'REPROVADA']) expect(destinoNoAppNovo('CLIENTE', r(s))).toBeNull()
  })
  it('motorista: chamada, saída/viagem e concluída nas telas novas', () => {
    expect(destinoNoAppNovo('MOTORISTA', r('SOLICITADA', { orcar: true }))).toBe('/chamada/p1')
    expect(destinoNoAppNovo('MOTORISTA', r('SOLICITADA', { orcar: true }, 'VEICULO_CLIENTE'))).toBeNull()
    expect(destinoNoAppNovo('MOTORISTA', r('SOLICITADA', { orcar: false }))).toBeNull()
    expect(destinoNoAppNovo('MOTORISTA', r('AGENDADA', { sair: true }))).toBe('/viagem/p1')
    expect(destinoNoAppNovo('MOTORISTA', r('AGENDADA', { sair: false }))).toBeNull()
    expect(destinoNoAppNovo('MOTORISTA', r('EM_ANDAMENTO', { concluir: true }))).toBe('/viagem/p1')
    expect(destinoNoAppNovo('MOTORISTA', r('CONCLUIDA'))).toBe('/viagem/p1')
  })
  it('ADM: sempre o detalhe de hoje', () => {
    expect(destinoNoAppNovo('ADM', r('EM_ANDAMENTO', { concluir: true }))).toBeNull()
  })
})
