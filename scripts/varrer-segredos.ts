// Falha o CI se o bundle publicado contiver segredo (SECURITY item 1).
// Uso: node scripts/varrer-segredos.ts [pasta=dist]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Achado {
  regra: string
  trecho: string
}

const REGRAS: Array<[string, RegExp]> = [
  ['chave secreta Supabase', /sb_secret_[A-Za-z0-9_-]{10,}/g],
  ['chave privada PEM', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['chave age', /AGE-SECRET-KEY-1[0-9A-Z]{20,}/g],
  ['chave Resend', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/g],
]
const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
const EXTENSOES = /\.(js|mjs|css|html|json|webmanifest|txt|map)$|_headers$/

const mascarar = (s: string) => `${s.slice(0, 12)}…`

function papelDoJwt(token: string): string | undefined {
  try {
    const corpo = token.split('.')[1] ?? ''
    return (JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as { role?: string }).role
  } catch {
    return undefined
  }
}

export function encontrarSegredos(texto: string): Achado[] {
  const achados: Achado[] = []
  for (const [regra, padrao] of REGRAS) {
    for (const m of texto.matchAll(padrao)) achados.push({ regra, trecho: mascarar(m[0]) })
  }
  for (const m of texto.matchAll(JWT)) {
    const papel = papelDoJwt(m[0])
    if (papel && papel !== 'anon') achados.push({ regra: `JWT com papel ${papel}`, trecho: mascarar(m[0]) })
  }
  return achados
}

function* arquivos(pasta: string): Generator<string> {
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome)
    if (statSync(caminho).isDirectory()) yield* arquivos(caminho)
    else yield caminho
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const pasta = process.argv[2] ?? 'dist'
  let total = 0
  for (const arquivo of arquivos(pasta)) {
    if (!EXTENSOES.test(arquivo)) continue
    for (const achado of encontrarSegredos(readFileSync(arquivo, 'utf8'))) {
      console.error(`${arquivo}: ${achado.regra} (${achado.trecho})`)
      total++
    }
  }
  if (total > 0) {
    console.error(`${total} segredo(s) encontrado(s) em ${pasta}`)
    process.exit(1)
  }
  console.log(`Nenhum segredo encontrado em ${pasta}`)
}
