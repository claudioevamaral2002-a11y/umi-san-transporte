import { describe, expect, it } from 'vitest'
import { topicoDoPerfil, topicoSaldo } from './topicos.ts'

describe('topicoDoPerfil', () => {
  it('cliente assina a própria empresa; a equipe assina "equipe"', () => {
    expect(topicoDoPerfil({ papel: 'CLIENTE', empresa_id: 'e1' })).toBe('empresa:e1')
    expect(topicoDoPerfil({ papel: 'CLIENTE', empresa_id: null })).toBeNull()
    expect(topicoDoPerfil({ papel: 'ADM', empresa_id: null })).toBe('equipe')
    expect(topicoDoPerfil({ papel: 'GESTOR_FROTA', empresa_id: null })).toBe('equipe')
    expect(topicoDoPerfil({ papel: 'MOTORISTA', empresa_id: null })).toBe('equipe')
    expect(topicoDoPerfil(null)).toBeNull()
  })

  it('saldo tem tópico próprio por empresa (fora de empresa:<id>, que a equipe assina)', () => {
    expect(topicoSaldo('e1')).toBe('saldo:e1')
    expect(topicoSaldo(null)).toBeNull()
    expect(topicoSaldo(undefined)).toBeNull()
  })
})
