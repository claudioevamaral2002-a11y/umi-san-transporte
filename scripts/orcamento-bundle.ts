// Falha se JS + CSS da carga inicial passarem de 150 KB gzip (meta: tela < 1 s em 4G).
// Uso: node scripts/orcamento-bundle.ts [pasta=dist]
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

export const LIMITE_BYTES = 150 * 1024

export function arquivosIniciais(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1] ?? '')
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const pasta = process.argv[2] ?? 'dist'
  const arquivos = arquivosIniciais(readFileSync(join(pasta, 'index.html'), 'utf8'))
  let total = 0
  for (const arquivo of arquivos) {
    const tamanho = gzipSync(readFileSync(join(pasta, arquivo))).length
    total += tamanho
    console.log(`${(tamanho / 1024).toFixed(1).padStart(7)} KB  ${arquivo}`)
  }
  console.log(`${(total / 1024).toFixed(1).padStart(7)} KB  total gzip (limite ${LIMITE_BYTES / 1024} KB)`)
  if (total > LIMITE_BYTES) process.exit(1)
}
