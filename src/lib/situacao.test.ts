import { describe, expect, it } from 'vitest'
import { etapaDoPedido, rotuloTrajeto, statusExibido } from './situacao.ts'

describe('situação do pedido', () => {
  it('trajeto em texto', () => {
    expect(rotuloTrajeto(true, true)).toBe('Levar e trazer (ida e volta)')
    expect(rotuloTrajeto(true, false)).toBe('Só levar')
    expect(rotuloTrajeto(false, true)).toBe('Só trazer')
  })

  it('pedido em aberto com prazo vencido aparece como expirado', () => {
    expect(statusExibido('SOLICITADA', true)).toBe('EXPIRADA')
    expect(statusExibido('ORCADA', false)).toBe('ORCADA')
    expect(statusExibido('AGENDADA', true)).toBe('AGENDADA')
  })

  it('linha do tempo: etapa atual e onde parou quando encerrou sem serviço', () => {
    expect(etapaDoPedido('SOLICITADA', [])).toEqual({ atual: 0, encerrado: null })
    expect(etapaDoPedido('ORCADA', [])).toEqual({ atual: 1, encerrado: null })
    expect(etapaDoPedido('CONCLUIDA', [])).toEqual({ atual: 4, encerrado: null })
    expect(
      etapaDoPedido('REPROVADA', [
        { de: null, para: 'SOLICITADA' },
        { de: 'SOLICITADA', para: 'ORCADA' },
        { de: 'ORCADA', para: 'REPROVADA' },
      ]),
    ).toEqual({ atual: 1, encerrado: 'REPROVADA' })
    expect(etapaDoPedido('CANCELADA', [{ de: 'SOLICITADA', para: 'CANCELADA' }])).toEqual({ atual: 0, encerrado: 'CANCELADA' })
  })
})
