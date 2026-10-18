import { describe, expect, it } from 'vitest'
import { dimensoesReduzidas, paraBase64 } from './fotos.ts'

describe('fotos', () => {
  it('reduz o lado maior para 1600 px mantendo a proporção; nunca amplia', () => {
    expect(dimensoesReduzidas(4000, 3000)).toEqual({ largura: 1600, altura: 1200 })
    expect(dimensoesReduzidas(3000, 4000)).toEqual({ largura: 1200, altura: 1600 })
    expect(dimensoesReduzidas(800, 600)).toEqual({ largura: 800, altura: 600 })
    expect(dimensoesReduzidas(1601, 1)).toEqual({ largura: 1600, altura: 1 })
  })

  it('base64 sem prefixo, inclusive para arquivos maiores que um bloco', async () => {
    expect(await paraBase64(new Blob([new Uint8Array([0xff, 0xd8, 0xff])]))).toBe('/9j/')
    const grande = new Uint8Array(70_000).map((_, i) => i % 256)
    expect(await paraBase64(new Blob([grande]))).toBe(Buffer.from(grande).toString('base64'))
  })
})
