import { describe, expect, it } from 'vitest'
import { textoCobranca } from './cobrancaPedido.ts'

// O Intl separa "R$" do número com espaço não separável.
const sem = (t: string | null) => t?.replace(/\s/g, ' ') ?? null

describe('textoCobranca (v2.2)', () => {
  it('encerrado sem multa: Sem cobrança (nunca o orçamento)', () => {
    for (const s of ['CANCELADA', 'EXPIRADA', 'RECUSADA', 'REPROVADA'] as const) {
      expect(textoCobranca(s, null)).toBe('Sem cobrança')
    }
    expect(textoCobranca('CANCELADA', undefined)).toBe('Sem cobrança')
    expect(textoCobranca('CANCELADA', 0)).toBe('Sem cobrança')
  })
  it('cancelada com multa: Multa R$ X', () => {
    expect(sem(textoCobranca('CANCELADA', 2455))).toBe('Multa R$ 24,55')
  })
  it('os outros status: null (a tela mostra o total)', () => {
    for (const s of ['SOLICITADA', 'ORCADA', 'AGENDADA', 'EM_ANDAMENTO', 'CONCLUIDA'] as const) {
      expect(textoCobranca(s, 1000)).toBeNull()
    }
  })
})
