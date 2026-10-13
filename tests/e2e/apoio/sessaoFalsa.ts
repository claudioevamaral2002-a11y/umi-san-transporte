// Estados de sessão simulados para testar as telas de entrada sem backend (o e2e com o Supabase
// do CI fica na Task 13). Grava uma sessão falsa no localStorage e responde às chamadas do Auth/PostgREST.
import type { Page, Route } from '@playwright/test'

export const URL_SUPABASE = 'http://127.0.0.1:54321'
const CHAVE_SESSAO = 'sb-127-auth-token'
const USUARIO = '00000000-0000-4000-8000-000000000001'

export interface PerfilFalso {
  nome?: string
  papel?: 'ADM' | 'GESTOR_FROTA' | 'MOTORISTA' | 'CLIENTE'
  /** Nível do cliente (padrão 2, solicitante); nulo para os demais papéis. */
  nivel?: 1 | 2 | 3
  empresa_nome?: string | null
  /** Só cliente (padrão `true`). */
  empresa_tem_contrato?: boolean
  senha_pendente?: boolean
  tem_2fa?: boolean
  ativo?: boolean
}

const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')

function jwt(aal: 'aal1' | 'aal2', metodo = 'password'): string {
  const agora = Math.floor(Date.now() / 1000)
  const corpo = { sub: USUARIO, role: 'authenticated', aal, amr: [{ method: metodo, timestamp: agora }], exp: agora + 3600 }
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(corpo)}.assinatura-falsa`
}

function usuario(fatorVerificado: boolean) {
  return {
    id: USUARIO,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'pessoa@exemplo.com.br',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-10-01T00:00:00Z',
    factors: fatorVerificado
      ? [{ id: 'fator-1', factor_type: 'totp', status: 'verified', friendly_name: 'Autenticador', created_at: '', updated_at: '' }]
      : [],
  }
}

/** Resposta JSON como a do Supabase (o cabeçalho de versão faz o supabase-js ler `code` dos erros). */
export const json = (route: Route, corpo: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'x-supabase-api-version': '2024-01-01', 'access-control-expose-headers': 'x-supabase-api-version' },
    body: JSON.stringify(corpo),
  })

/** Abre a página já "logada" no estado pedido. Devolve os corpos enviados às Edge Functions. */
export async function comSessaoFalsa(
  page: Page,
  perfil: PerfilFalso,
  opcoes: { aal?: 'aal1' | 'aal2'; /** Abre deslogado; a sessão nasce no login (POST /token?grant_type=password). */ semSessaoInicial?: boolean } = {},
) {
  const tem2fa = perfil.tem_2fa ?? false
  const sessao = {
    access_token: jwt(opcoes.aal ?? 'aal1'),
    refresh_token: 'refresh-falso',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: usuario(tem2fa),
  }
  await page.route(`${URL_SUPABASE}/auth/v1/token?grant_type=password`, (route) => json(route, sessao))
  if (!opcoes.semSessaoInicial) {
    await page.addInitScript(
      ([chave, valor]) => {
        if (!sessionStorage.getItem('sessao-falsa-gravada')) {
          localStorage.setItem(chave, valor)
          sessionStorage.setItem('sessao-falsa-gravada', '1')
        }
      },
      [CHAVE_SESSAO, JSON.stringify(sessao)] as const,
    )
  }

  const enviados: Array<{ funcao: string; corpo: unknown }> = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/meu_perfil`, (route) =>
    json(route, [
      {
        nome: perfil.nome ?? 'Ana Souza',
        papel: perfil.papel ?? 'MOTORISTA',
        nivel: perfil.papel === 'CLIENTE' ? (perfil.nivel ?? 2) : null,
        empresa_id: perfil.papel === 'CLIENTE' ? '00000000-0000-4000-8000-0000000000e1' : null,
        empresa_nome: perfil.empresa_nome ?? null,
        empresa_logo_caminho: null,
        empresa_tem_contrato: perfil.papel === 'CLIENTE' ? (perfil.empresa_tem_contrato ?? true) : null,
        ativo: perfil.ativo ?? true,
        senha_pendente: perfil.senha_pendente ?? false,
        tem_2fa: tem2fa,
      },
    ]),
  )
  await page.route(`${URL_SUPABASE}/auth/v1/user`, (route) => json(route, usuario(tem2fa)))
  await page.route(`${URL_SUPABASE}/auth/v1/logout**`, (route) => route.fulfill({ status: 204 }))
  await page.route(`${URL_SUPABASE}/auth/v1/factors`, (route) =>
    json(route, {
      id: 'fator-novo',
      type: 'totp',
      friendly_name: 'Autenticador',
      totp: {
        qr_code:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path d="M1 1h7v7H1zM21 1h7v7h-7zM1 21h7v7H1zM11 11h7v7h-7z" fill="#000"/></svg>',
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        uri: 'otpauth://totp/IVO%20Transportes:pessoa@exemplo.com.br?secret=JBSWY3DPEHPK3PXP&issuer=IVO%20Transportes',
      },
    }),
  )
  await page.route(`${URL_SUPABASE}/auth/v1/factors/*/challenge`, (route) =>
    json(route, { id: 'desafio-1', type: 'totp', expires_at: Math.floor(Date.now() / 1000) + 300 }),
  )
  await page.route(`${URL_SUPABASE}/auth/v1/factors/*/verify`, (route) =>
    json(route, { code: 'mfa_verification_failed', msg: 'Invalid TOTP code entered' }, 422),
  )
  await page.route(`${URL_SUPABASE}/functions/v1/*`, async (route) => {
    const funcao = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    enviados.push({ funcao, corpo: route.request().postDataJSON() })
    const atual = respostasFuncoes.get(page)?.shift() ?? { ok: true }
    await json(route, atual)
  })
  return enviados
}

const respostasFuncoes = new WeakMap<Page, Array<Record<string, unknown>>>()

/** Próximas respostas das Edge Functions (na ordem); depois disso, `{ ok: true }`. */
export function responderFuncoes(page: Page, ...respostas: Array<Record<string, unknown>>) {
  respostasFuncoes.set(page, respostas)
}

/**
 * Link curto sem sessão prévia: responde ao resgate (POST resgatar-link) e ao que o app pede depois do
 * setSession. Devolve todas as requisições feitas pela página (para provar que abrir não chama nada).
 */
export async function simularResgateDeLink(
  page: Page,
  resposta: Record<string, unknown> | 'sessao',
  perfil: PerfilFalso = { papel: 'CLIENTE', senha_pendente: true },
) {
  const pedidos: Array<{ url: string; metodo: string }> = []
  page.on('request', (r) => pedidos.push({ url: r.url(), metodo: r.method() }))
  await page.route(`${URL_SUPABASE}/functions/v1/resgatar-link`, (route) =>
    json(
      route,
      resposta === 'sessao' ? { ok: true, access_token: jwt('aal1', 'otp'), refresh_token: 'refresh-falso' } : resposta,
    ),
  )
  await page.route(`${URL_SUPABASE}/auth/v1/user`, (route) => json(route, usuario(false)))
  await page.route(`${URL_SUPABASE}/auth/v1/logout**`, (route) => route.fulfill({ status: 204 }))
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/meu_perfil`, (route) =>
    json(route, [
      {
        nome: perfil.nome ?? 'Carla Dias',
        papel: perfil.papel ?? 'CLIENTE',
        nivel: (perfil.papel ?? 'CLIENTE') === 'CLIENTE' ? (perfil.nivel ?? 2) : null,
        empresa_id: null,
        empresa_nome: null,
        empresa_logo_caminho: null,
        empresa_tem_contrato: null,
        ativo: perfil.ativo ?? true,
        senha_pendente: perfil.senha_pendente ?? true,
        tem_2fa: false,
      },
    ]),
  )
  return pedidos
}
