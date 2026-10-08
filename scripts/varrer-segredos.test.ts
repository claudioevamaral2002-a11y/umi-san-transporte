import { describe, expect, it } from 'vitest'
import { encontrarSegredos } from './varrer-segredos.ts'

const jwt = (corpo: object) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(corpo)).toString('base64url')}.assinatura`

describe('encontrarSegredos', () => {
  it('aceita chave publishable e JWT anon', () => {
    expect(encontrarSegredos(`k="sb_publishable_abc123def456"; a="${jwt({ role: 'anon' })}"`)).toEqual([])
  })

  it('acusa chave secreta do Supabase', () => {
    expect(encontrarSegredos('x="sb_secret_ZZZZZZZZZZZZZZ"').map((a) => a.regra)).toEqual(['chave secreta Supabase'])
  })

  it('acusa JWT com papel service_role', () => {
    expect(encontrarSegredos(jwt({ role: 'service_role' })).map((a) => a.regra)).toEqual(['JWT com papel service_role'])
  })

  it('acusa chave privada PEM e chave age', () => {
    const texto = '-----BEGIN PRIVATE KEY-----\nAGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQ'
    expect(encontrarSegredos(texto).map((a) => a.regra)).toEqual(['chave privada PEM', 'chave age'])
  })

  it('não repete o segredo inteiro no relatório', () => {
    const [achado] = encontrarSegredos('sb_secret_0123456789abcdefghij')
    expect(achado?.trecho.length).toBeLessThan(15)
  })
})
