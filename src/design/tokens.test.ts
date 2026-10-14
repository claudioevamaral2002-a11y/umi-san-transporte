import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contraste, lerTokens } from './contraste.ts'

const tokens = lerTokens(readFileSync(new URL('./tokens.css', import.meta.url), 'utf8'))

// [frente, fundo, mínimo]: 4,5 para texto; 3 para marcadores, contornos e controles (WCAG 1.4.3 e 1.4.11).
const PARES: Array<[string, string, number]> = [
  ['--cor-texto', '--cor-fundo', 4.5],
  ['--cor-texto', '--cor-superficie', 4.5],
  ['--cor-texto-suave', '--cor-fundo', 4.5],
  ['--cor-texto-suave', '--cor-superficie', 4.5],
  ['--cor-selecao-texto', '--cor-selecao', 4.5],
  ['--cor-selecao', '--cor-fundo', 3],
  ['--cor-selecao', '--cor-superficie', 3],
  ['--cor-acao-texto', '--cor-acao', 4.5],
  ['--cor-alerta-texto', '--cor-fundo', 4.5],
  ['--cor-alerta-texto', '--cor-superficie', 4.5],
  ['--cor-livre', '--cor-livre-fundo', 4.5],
  ['--cor-ocupado', '--cor-fundo', 3],
  ['--cor-ocupado', '--cor-superficie', 3],
  ['--marcador-meu', '--cor-superficie', 3],
  ['--marcador-aguardando', '--cor-superficie', 3],
  ['--marcador-ocupado', '--cor-superficie', 3],
  ['--cor-bloco-texto', '--cor-bloco', 4.5],
  ['--cor-bloco-suave', '--cor-bloco', 4.5],
  ['--cor-bloco-alerta', '--cor-bloco', 4.5],
  ['--cor-comando-texto', '--cor-comando', 4.5],
  ['--cor-link', '--cor-superficie', 4.5],
  ['--cor-link', '--cor-fundo', 4.5],
]

for (const modo of ['claro', 'escuro', 'alto'] as const) {
  describe(`pares AA no modo ${modo}`, () => {
    for (const [frente, fundo, minimo] of PARES) {
      it(`${frente} sobre ${fundo} ≥ ${minimo}`, () => {
        const t = tokens[modo]
        expect(t[frente], frente).toMatch(/^#[0-9a-f]{6}$/)
        expect(t[fundo], fundo).toMatch(/^#[0-9a-f]{6}$/)
        expect(contraste(t[frente]!, t[fundo]!)).toBeGreaterThanOrEqual(minimo)
      })
    }
  })
}

it('o laranja do contorno de seleção aparece no escuro (≥ 3:1 sobre o fundo)', () => {
  expect(contraste(tokens.escuro['--cor-laranja']!, tokens.escuro['--cor-fundo']!)).toBeGreaterThanOrEqual(3)
})
