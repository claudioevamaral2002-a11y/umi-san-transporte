// Links curtos de acesso (convite/recuperação) — lógica pura, usada pelas Edge Functions e pelos scripts.
//
// O link entregue à pessoa é `${origem}/c/<código>`: abrir a página não consome nada (pré-visualização do
// WhatsApp, pré-carregamento do navegador e varredores de e-mail fazem só GET). O token de uso único do
// Supabase Auth só é gasto quando a pessoa toca em "Continuar" (POST resgatar-link → verifyOtp no servidor).

/** Alfabeto sem símbolos ambíguos (sem 0/O, 1/I/L): 8 dígitos + 23 letras = 31 símbolos. */
export const ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const TAMANHO_CODIGO = 10

const CODIGO = new RegExp(`^[${ALFABETO_CODIGO}]{${TAMANHO_CODIGO}}$`)

export type TipoLink = 'invite' | 'recovery'

export function tipoLinkValido(tipo: unknown): tipo is TipoLink {
  return tipo === 'invite' || tipo === 'recovery'
}

/**
 * Normaliza o código digitado/colado: maiúsculas, sem hífens nem espaços. `null` se não for um código
 * válido (tamanho ou símbolo fora do alfabeto).
 */
export function normalizarCodigo(bruto: unknown): string | null {
  if (typeof bruto !== 'string' || bruto.length > 40) return null
  const codigo = bruto.toUpperCase().replace(/[\s-]/g, '')
  return CODIGO.test(codigo) ? codigo : null
}

/** Exibição agrupada (`K7M2-QX9PRT`); a URL usa o código sem hífen. */
export function formatarCodigo(codigo: string): string {
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`
}

/** `${origem}/c/<código>` (origem sem barra final). `null` se a origem ou o código forem inválidos. */
export function montarLinkCurto(origem: string, codigo: string): string | null {
  const normalizado = normalizarCodigo(codigo)
  if (!normalizado) return null
  let url: URL
  try {
    url = new URL(origem)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return `${url.origin}/c/${normalizado}`
}

/** Extrai o código de um link curto (`…/c/<código>`), ou `null`. */
export function codigoDoLink(link: string): string | null {
  try {
    const m = /^\/c\/([^/]+)\/?$/.exec(new URL(link).pathname)
    return m ? normalizarCodigo(decodeURIComponent(m[1]!)) : null
  } catch {
    return null
  }
}

/** IP do cliente para o limite por IP: o do Cloudflare se houver; senão o primeiro do X-Forwarded-For. */
export function ipDoPedido(cabecalhos: Headers): string {
  const cf = cabecalhos.get('cf-connecting-ip')?.trim()
  const xff = cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (cf || xff || 'desconhecido').slice(0, 64)
}

/** Resposta mínima de `auth.admin.generateLink` usada aqui. */
interface Gerado {
  data?: { properties?: { hashed_token?: string | null } | null; user?: { id?: string | null } | null } | null
  error?: unknown
}

/** Cliente com `.rpc` (supabase-js) no schema `api`. */
interface ComRpc {
  rpc(nome: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
}

export type ResultadoLink = { ok: true; link: string } | { ok: false; etapa: 'gerar' | 'registrar' | 'montar' }

/**
 * Depois do `generateLink`: guarda o `hashed_token` atrás de um código curto (RPC só da service_role) e
 * devolve o link curto. Nunca devolve o `action_link` do Supabase (ele é consumido por qualquer GET).
 */
export async function registrarLinkCurto(
  servico: ComRpc,
  gerado: Gerado,
  tipo: TipoLink,
  origem: string,
): Promise<ResultadoLink> {
  const tokenHash = gerado.data?.properties?.hashed_token
  const usuario = gerado.data?.user?.id
  if (gerado.error || !tokenHash || !usuario) return { ok: false, etapa: 'gerar' }
  const { data, error } = await servico.rpc('sistema_criar_link_curto', {
    p_token_hash: tokenHash,
    p_tipo: tipo,
    p_usuario: usuario,
  })
  const resposta = data as { ok?: boolean; codigo_link?: unknown } | null
  if (error || !resposta?.ok || typeof resposta.codigo_link !== 'string') return { ok: false, etapa: 'registrar' }
  const link = montarLinkCurto(origem, resposta.codigo_link)
  return link ? { ok: true, link } : { ok: false, etapa: 'montar' }
}
