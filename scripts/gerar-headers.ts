// Substitui __CSP__ em dist/_headers pela CSP do projeto Supabase alvo (especificação 9, itens 18 e 19).
// Uso: node scripts/gerar-headers.ts [modo=production]
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

export function montarCsp(urlSupabase: string): string {
  const url = new URL(urlSupabase)
  const websocket = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`
  const diretivas: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", 'https://challenges.cloudflare.com']],
    ['frame-src', ['https://challenges.cloudflare.com']],
    ['connect-src', ["'self'", url.origin, websocket]],
    ['img-src', ["'self'", 'data:', 'blob:', url.origin]],
    ['style-src', ["'self'"]],
    ['font-src', ["'self'"]],
    ['worker-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
    ['object-src', ["'none'"]],
  ]
  return diretivas.map(([nome, valores]) => `${nome} ${valores.join(' ')}`).join('; ')
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const modo = process.argv[2] ?? 'production'
  const urlSupabase = process.env.VITE_SUPABASE_URL ?? loadEnv(modo, process.cwd(), 'VITE_').VITE_SUPABASE_URL
  if (!urlSupabase) {
    console.error('VITE_SUPABASE_URL ausente')
    process.exit(1)
  }
  const caminho = 'dist/_headers'
  const original = readFileSync(caminho, 'utf8')
  if (!original.includes('__CSP__')) {
    console.error(`${caminho} sem o marcador __CSP__`)
    process.exit(1)
  }
  writeFileSync(caminho, original.replace('__CSP__', montarCsp(urlSupabase)))
  console.log(`CSP gravada em ${caminho} para ${new URL(urlSupabase).host}`)
}
