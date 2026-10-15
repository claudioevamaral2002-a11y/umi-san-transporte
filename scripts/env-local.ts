// Gera .env.test e .env.development.local a partir do Supabase local em execução.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const saida = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
const status = JSON.parse(saida.slice(saida.indexOf('{'))) as Record<string, string | undefined>

const chavePublica = status.PUBLISHABLE_KEY ?? status.ANON_KEY
const chaveServico = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY
if (!status.API_URL || !status.DB_URL || !chavePublica || !chaveServico) {
  throw new Error('supabase status incompleto — o stack local está rodando? (npx supabase start)')
}

const linhas = [
  `SUPABASE_URL=${status.API_URL}`,
  `SUPABASE_ANON_KEY=${chavePublica}`,
  `SUPABASE_SERVICE_KEY=${chaveServico}`,
  `SUPABASE_DB_URL=${status.DB_URL}`,
  `VITE_SUPABASE_URL=${status.API_URL}`,
  `VITE_SUPABASE_PUBLISHABLE_KEY=${chavePublica}`,
  // Chave de site de teste oficial da Cloudflare (sempre passa).
  `VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA`,
  // Fase 3A: chave falsa; o e2e simula a Map Tiles API (nenhuma chamada real ao Google).
  `VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR=chave-falsa-dos-mapas`,
]
const conteudo = linhas.join('\n') + '\n'
writeFileSync('.env.test', conteudo)
writeFileSync('.env.development.local', conteudo)
console.log('Gerados .env.test e .env.development.local (Supabase local)')
