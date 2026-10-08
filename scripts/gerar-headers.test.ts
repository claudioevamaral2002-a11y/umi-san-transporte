import { describe, expect, it } from 'vitest'
import { montarCsp } from './gerar-headers.ts'

describe('montarCsp', () => {
  it('produção: https e wss do projeto Supabase, sem unsafe-*', () => {
    const csp = montarCsp('https://abc.supabase.co')
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co")
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com")
    expect(csp).toContain("style-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toMatch(/unsafe-(inline|eval)/)
  })

  it('local: http e ws com porta', () => {
    expect(montarCsp('http://127.0.0.1:54321')).toContain(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321",
    )
  })
})
