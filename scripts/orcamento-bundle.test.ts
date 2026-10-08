import { describe, expect, it } from 'vitest'
import { arquivosIniciais } from './orcamento-bundle.ts'

describe('arquivosIniciais', () => {
  it('lista JS e CSS referenciados pelo index.html, inclusive modulepreload', () => {
    const html = `
      <script type="module" crossorigin src="/assets/index-a1.js"></script>
      <link rel="modulepreload" crossorigin href="/assets/vendor-b2.js">
      <link rel="stylesheet" crossorigin href="/assets/index-c3.css">
      <link rel="icon" href="/favicon.ico">
      <script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script>`
    expect(arquivosIniciais(html)).toEqual(['assets/index-a1.js', 'assets/vendor-b2.js', 'assets/index-c3.css'])
  })
})
