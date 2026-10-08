import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'

function lerEnv(nome: string): string {
  const valor = process.env[nome]
  if (!valor) throw new Error(`Variável ${nome} ausente — rode: node scripts/env-local.ts`)
  return valor
}

export const URL_SUPABASE = lerEnv('SUPABASE_URL')
export const CHAVE_PUBLICA = lerEnv('SUPABASE_ANON_KEY')

/** Token aceito pelo segredo de teste público da Cloudflare (CI/local). */
export const TOKEN_CAPTCHA_TESTE = 'XXXX.DUMMY.TOKEN.XXXX'

const semSessao = { auth: { persistSession: false, autoRefreshToken: false } }

export function clientePublico() {
  return createClient(URL_SUPABASE, CHAVE_PUBLICA, { ...semSessao, db: { schema: 'api' } })
}

function clienteServico(): SupabaseClient {
  return createClient(URL_SUPABASE, lerEnv('SUPABASE_SERVICE_KEY'), semSessao)
}

export interface UsuarioTeste {
  id: string
  token: string
  cliente: ReturnType<typeof clientePublico>
}

export async function criarUsuario(): Promise<UsuarioTeste> {
  const email = `teste-${randomUUID()}@teste.local`
  const senha = `Senha-${randomUUID()}`
  const criado = await clienteServico().auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (criado.error || !criado.data.user) throw criado.error ?? new Error('createUser não retornou usuário')

  const cliente = clientePublico()
  const login = await cliente.auth.signInWithPassword({
    email,
    password: senha,
    options: { captchaToken: TOKEN_CAPTCHA_TESTE },
  })
  if (login.error || !login.data.session) throw login.error ?? new Error('login sem sessão')
  return { id: criado.data.user.id, token: login.data.session.access_token, cliente }
}

/** Conexão direta como postgres, só para preparar cenários de teste. */
export async function comBanco<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: lerEnv('SUPABASE_DB_URL') })
  await db.connect()
  try {
    return await fn(db)
  } finally {
    await db.end()
  }
}
