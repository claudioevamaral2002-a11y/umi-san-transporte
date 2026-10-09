import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import pg from 'pg'
import { gerarTotp } from './totp.ts'

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

export type PapelTeste = 'ADM' | 'GESTOR_FROTA' | 'MOTORISTA' | 'CLIENTE'

/** Nível do cliente: 1 gestor da empresa, 2 solicitante, 3 visualizador. */
export type NivelTeste = 1 | 2 | 3

export interface Resultado {
  ok: boolean
  codigo?: string
  [campo: string]: unknown
}

export interface Pessoa extends UsuarioTeste {
  email: string
  senha: string
  papel: PapelTeste
  nivel: NivelTeste | null
  empresaId: string | null
  /** Segredo base32 do TOTP, quando cadastrado. */
  segredoTotp: string | null
}

/** Cria uma empresa direto no banco (cenário de teste). */
export async function empresaNova(nome = `Empresa ${randomUUID().slice(0, 8)}`): Promise<string> {
  return comBanco(async (db) => {
    const r = await db.query<{ id: string }>('insert into app.empresas (nome) values ($1) returning id', [nome])
    return r.rows[0]!.id
  })
}

/** Cadastra e verifica um TOTP no cliente; ao final a sessão do cliente é aal2. */
export async function cadastrarTotp(cliente: UsuarioTeste['cliente']): Promise<string> {
  const inscricao = await cliente.auth.mfa.enroll({ factorType: 'totp' })
  if (inscricao.error || !inscricao.data) throw inscricao.error ?? new Error('mfa.enroll sem dados')
  const segredo = inscricao.data.totp.secret
  const desafio = await cliente.auth.mfa.challenge({ factorId: inscricao.data.id })
  if (desafio.error || !desafio.data) throw desafio.error ?? new Error('mfa.challenge sem dados')
  const verificado = await cliente.auth.mfa.verify({
    factorId: inscricao.data.id,
    challengeId: desafio.data.id,
    code: gerarTotp(segredo),
  })
  if (verificado.error) throw verificado.error
  return segredo
}

/**
 * Cria uma pessoa com perfil: convite (direto no banco) → usuário pela Admin API (a trigger cria o perfil)
 * → senha confirmada → login com captcha → TOTP para quem não é CLIENTE (a menos que `mfa: false`).
 * Sem `mfa`, ADM/GESTOR_FROTA/MOTORISTA ficam em aal1 (útil para provar a recusa).
 * CLIENTE sem `nivel` nasce N2 (solicitante: sem poderes de gestão).
 */
export async function criarPessoa(
  opcoes: { papel: PapelTeste; nivel?: NivelTeste; empresa?: string; nome?: string; mfa?: boolean } = {
    papel: 'CLIENTE',
  },
): Promise<Pessoa> {
  const { papel } = opcoes
  const empresaId = papel === 'CLIENTE' ? (opcoes.empresa ?? (await empresaNova())) : null
  const nivel = papel === 'CLIENTE' ? (opcoes.nivel ?? 2) : null
  const email = `${papel.toLowerCase()}-${randomUUID()}@teste.local`
  const senha = `Senha-${randomUUID()}`
  const nome = opcoes.nome ?? `Pessoa ${papel} ${randomUUID().slice(0, 6)}`

  await comBanco((db) =>
    db.query(
      'insert into app.convites (email, nome, papel, empresa_id, nivel) values ($1, $2, $3::app.papel, $4, $5::smallint)',
      [email, nome, papel, empresaId, nivel],
    ),
  )
  const criado = await clienteServico().auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (criado.error || !criado.data.user) throw criado.error ?? new Error('createUser não retornou usuário')
  const id = criado.data.user.id

  const liberado = await comBanco((db) =>
    db.query('update app.perfis set senha_pendente = false where usuario_id = $1', [id]),
  )
  if (liberado.rowCount !== 1) throw new Error('perfil não foi criado pela trigger do convite')

  const cliente = clientePublico()
  const login = await cliente.auth.signInWithPassword({
    email,
    password: senha,
    options: { captchaToken: TOKEN_CAPTCHA_TESTE },
  })
  if (login.error || !login.data.session) throw login.error ?? new Error('login sem sessão')

  let segredoTotp: string | null = null
  if (papel !== 'CLIENTE' && opcoes.mfa !== false) segredoTotp = await cadastrarTotp(cliente)

  const sessao = await cliente.auth.getSession()
  const token = sessao.data.session?.access_token
  if (!token) throw new Error('sem sessão após preparar a pessoa')
  return { id, email, senha, papel, nivel, empresaId, cliente, token, segredoTotp }
}

/** Chama uma RPC de negócio (`{ok, codigo}`) e devolve o resultado tipado. */
export async function rpc(
  quem: Pick<UsuarioTeste, 'cliente'>,
  nome: string,
  args: Record<string, unknown> = {},
): Promise<Resultado> {
  const { data, error } = await quem.cliente.rpc(nome, args)
  if (error) throw new Error(`rpc ${nome}: ${error.message}`)
  return data as Resultado
}
