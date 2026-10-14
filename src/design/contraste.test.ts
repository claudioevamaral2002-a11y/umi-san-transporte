import { describe, expect, it } from 'vitest'
import { contraste, lerTokens } from './contraste.ts'

describe('contraste', () => {
  it('calcula pela fórmula WCAG', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contraste('#f6f4ee', '#0a2540')).toBeCloseTo(14.13, 1)
    expect(contraste('#ff6a00', '#0a2540')).toBeCloseTo(5.41, 1)
  })
})

describe('lerTokens', () => {
  it('separa claro, escuro e alto contraste', () => {
    const css = `:root { --a: #111111; --b: var(--a); }
@media (prefers-color-scheme: dark) { :root:not([data-tema="claro"]) { --a: #222222; } }
:root[data-contraste="alto"] { --a: #333333; }`
    const t = lerTokens(css)
    expect(t.claro['--b']).toBe('#111111')
    expect(t.escuro['--a']).toBe('#222222')
    expect(t.escuro['--b']).toBe('#222222')
    expect(t.alto['--a']).toBe('#333333')
  })
})
