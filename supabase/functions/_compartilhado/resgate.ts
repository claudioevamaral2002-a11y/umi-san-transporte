// Resgate do link curto (`/c/<código>` → "Continuar"): sem JWT (a pessoa ainda não tem sessão).
// Só POST: GETs de pré-visualização/pré-carregamento nunca chegam aqui com efeito.
import { cabecalhosCors, origemPermitida, origensPermitidas } from './cors.ts'
import { ipDoPedido, normalizarCodigo, tipoLinkValido } from './links.ts'
import { logErro } from './log.ts'
import { criarLimitador, lerJson, responder } from './respostas.ts'

interface ComRpc {
  rpc(nome: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
}

interface ComVerifyOtp {
  auth: {
    verifyOtp(params: { token_hash: string; type: 'invite' | 'recovery' }): PromiseLike<{
      data: { session: { access_token: string; refresh_token: string } | null } | null
      error: unknown
    }>
  }
}

export interface DependenciasResgate {
  origens: () => string | undefined
  clientes: () => { publico: ComVerifyOtp; servico: ComRpc }
  /** Freio em memória por IP e instância (o limite de verdade é o do banco: 30 por IP/dia). */
  limitador?: { permitir(chave: string): boolean }
}

const FUNCAO = 'resgatar-link'

export function criarManipuladorResgate(deps: DependenciasResgate) {
  const limitador = deps.limitador ?? criarLimitador(10, 60_000)
  return async (req: Request): Promise<Response> => {
    const origens = origensPermitidas(deps.origens())
    const origem = req.headers.get('origin')
    const cors = cabecalhosCors(origem, origens)

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method !== 'POST') {
      return responder({ ok: false, codigo: 'METODO_NAO_PERMITIDO' }, 405, { ...cors, Allow: 'POST, OPTIONS' })
    }
    if (origem !== null && !origemPermitida(origem, origens)) {
      return responder({ ok: false, codigo: 'ORIGEM_NAO_PERMITIDA' }, 403)
    }

    const ip = ipDoPedido(req.headers)
    if (!limitador.permitir(ip)) return responder({ ok: false, codigo: 'LIMITE_EXCEDIDO' }, 200, cors)

    try {
      const corpo = await lerJson(req, 1_000)
      if (!corpo) return responder({ ok: false, codigo: 'CAMPOS_INVALIDOS' }, 200, cors)
      // Código malformado também passa pelo banco: conta no limite por IP e fica auditado.
      const codigo = normalizarCodigo(corpo.codigo) ?? (typeof corpo.codigo === 'string' ? corpo.codigo.slice(0, 40) : '')

      const { publico, servico } = deps.clientes()
      const { data, error } = await servico.rpc('sistema_resgatar_link', { p_codigo: codigo, p_ip: ip })
      const resgate = data as { ok?: boolean; codigo?: unknown; token_hash?: unknown; tipo?: unknown } | null
      if (error || !resgate) {
        logErro(FUNCAO, 'resgatar', error ?? undefined)
        return responder({ ok: false, codigo: 'ERRO_INESPERADO' }, 200, cors)
      }
      if (!resgate.ok) return responder({ ok: false, codigo: String(resgate.codigo ?? 'ERRO_INESPERADO') }, 200, cors)
      if (typeof resgate.token_hash !== 'string' || !tipoLinkValido(resgate.tipo)) {
        logErro(FUNCAO, 'resgate-incompleto')
        return responder({ ok: false, codigo: 'ERRO_INESPERADO' }, 200, cors)
      }

      // POST /auth/v1/verify no servidor: é aqui (e só aqui) que o token de uso único é gasto.
      const verificado = await publico.auth.verifyOtp({ token_hash: resgate.token_hash, type: resgate.tipo })
      const sessao = verificado.data?.session
      if (verificado.error || !sessao) {
        // Token já invalidado no Auth (ex.: um link mais novo foi gerado) ou expirado.
        logErro(FUNCAO, 'verificar', verificado.error ?? undefined)
        await servico.rpc('sistema_registrar', {
          p_usuario: null,
          p_acao: 'VERIFICAR_LINK',
          p_alvo: 'link',
          p_resultado: 'NEGADO',
          p_codigo: 'EXPIRADO',
        })
        return responder({ ok: false, codigo: 'EXPIRADO' }, 200, cors)
      }
      return responder({ ok: true, access_token: sessao.access_token, refresh_token: sessao.refresh_token }, 200, cors)
    } catch (e) {
      logErro(FUNCAO, 'excecao', e)
      return responder({ ok: false, codigo: 'ERRO_INESPERADO' }, 200, cors)
    }
  }
}
