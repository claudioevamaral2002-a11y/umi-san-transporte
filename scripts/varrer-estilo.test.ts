import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { varrerEstilo } from './varrer-estilo.ts'

function arquivos(pasta: string): Array<{ caminho: string; texto: string }> {
  return readdirSync(pasta).flatMap((n) => {
    const c = join(pasta, n)
    return statSync(c).isDirectory() ? arquivos(c) : /\.tsx?$/.test(c) && !/\.test\.ts$/.test(c) ? [{ caminho: c, texto: readFileSync(c, 'utf8') }] : []
  })
}

describe('varrerEstilo', () => {
  it('acha separador " · " e seta em texto, ignorando comentários', () => {
    expect(
      varrerEstilo([{ caminho: 'a.tsx', texto: '<p>Livre · 10:00</p>\n<b>Ir →</b>\n// comentário · ok\n/* outro → ok */' }]),
    ).toEqual(['a.tsx:1', 'a.tsx:2'])
  })
  it('telas e textos do app não usam " · " nem "→"', () => {
    expect(varrerEstilo([...arquivos('src/telas'), ...arquivos('src/lib'), ...arquivos('src/design')])).toEqual([])
  })
})
