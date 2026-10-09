import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { escreverResumo, lerConfig, montarResumoLink, normalizarSiteUrl, validarEmail, validarNome } from './adm-comum.ts'

describe('validação de argumentos', () => {
  it('e-mail: normaliza e rejeita inválidos', () => {
    expect(validarEmail('  Dono@Exemplo.COM ')).toBe('dono@exemplo.com')
    for (const ruim of [undefined, '', 'sem-arroba', 'a@b', 'a b@c.com', 'a@@c.com']) expect(validarEmail(ruim)).toBeNull()
  })
  it('nome: 2 a 120 caracteres', () => {
    expect(validarNome(' Maria ')).toBe('Maria')
    expect(validarNome('A')).toBeNull()
    expect(validarNome('x'.repeat(121))).toBeNull()
    expect(validarNome(undefined)).toBeNull()
  })
  it('SITE_URL: https ou localhost; remove caminho', () => {
    expect(normalizarSiteUrl('https://umi-san-transporte.pages.dev/')).toBe('https://umi-san-transporte.pages.dev')
    expect(normalizarSiteUrl('http://localhost:8788')).toBe('http://localhost:8788')
    expect(normalizarSiteUrl('http://exemplo.com')).toBeNull()
    expect(normalizarSiteUrl('lixo')).toBeNull()
  })
  it('config: exige URL e chave; usa o site padrão', () => {
    expect(lerConfig({ SUPABASE_URL: 'https://x.supabase.co' })).toBeNull()
    expect(lerConfig({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' })?.siteUrl).toBe(
      'https://umi-san-transporte.pages.dev',
    )
  })
})

describe('resumo', () => {
  it('contém validade, uso único e o link; marca recuperação', () => {
    const md = montarResumoLink({ titulo: 'T', email: 'a@b.co', link: 'https://l/x', recuperacao: true })
    expect(md).toContain('(https://l/x)')
    expect(md).toContain('24 h')
    expect(md).toContain('uso único')
    expect(md).toContain('Continuar')
    expect(md).toContain('recuperação')
  })
  it('escreve no arquivo (append) e recusa sem caminho', () => {
    const arq = join(mkdtempSync(join(tmpdir(), 'resumo-')), 's.md')
    expect(escreverResumo(arq, 'um')).toBe(true)
    expect(escreverResumo(arq, 'dois')).toBe(true)
    expect(readFileSync(arq, 'utf8')).toBe('um\ndois\n')
    expect(escreverResumo(undefined, 'x')).toBe(false)
  })
})
