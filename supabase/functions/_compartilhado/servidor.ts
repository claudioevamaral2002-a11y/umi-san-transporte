import { cabecalhosCors, escolherOrigem, origemPermitida, origensPermitidas } from './cors.ts'
import { criarClientes, origensConfiguradas, type Clientes } from './clientes.ts'
import { logErro } from './log.ts'
import { criarLimitador, extrairBearer, lerJson, responder, type Corpo } from './respostas.ts'

export interface Contexto extends Clientes {
  funcao: string
  usuarioId: string
  corpo: Record<string, unknown>
  /** Origem do pedido (se permitida) ou a primeira configurada; `null` sem configuração. */
  origem: string | null
}

/**
 * Casca comum: método, CORS, JWT, limite por usuário e corpo JSON. Nunca devolve detalhes internos.
 * `limitePorMinuto`: freio em memória por instância (o controle de verdade são os limites no banco); padrão 20.
 * `limiteCorpoBytes`: tamanho máximo do corpo JSON; padrão LIMITE_CORPO_BYTES (só a foto precisa de mais).
 */
export function criarServidor(
  funcao: string,
  manipulador: (ctx: Contexto) => Promise<Corpo>,
  opcoes: { limitePorMinuto?: number; limiteCorpoBytes?: number } = {},
) {
  const limitador = criarLimitador(opcoes.limitePorMinuto ?? 20, 60_000)
  return async (req: Request): Promise<Response> => {
    const origens = origensPermitidas(origensConfiguradas())
    const origem = req.headers.get('origin')
    const cors = cabecalhosCors(origem, origens)

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method !== 'POST') {
      return responder({ ok: false, codigo: 'METODO_NAO_PERMITIDO' }, 405, { ...cors, Allow: 'POST, OPTIONS' })
    }
    if (origem !== null && !origemPermitida(origem, origens)) {
      return responder({ ok: false, codigo: 'ORIGEM_NAO_PERMITIDA' }, 403)
    }

    const jwt = extrairBearer(req)
    if (!jwt) return responder({ ok: false, codigo: 'NAO_AUTENTICADO' }, 401, cors)

    try {
      const clientes = criarClientes(jwt)
      const { data, error } = await clientes.servico.auth.getUser(jwt)
      if (error || !data.user) return responder({ ok: false, codigo: 'NAO_AUTENTICADO' }, 401, cors)
      if (!limitador.permitir(data.user.id)) return responder({ ok: false, codigo: 'LIMITE_EXCEDIDO' }, 200, cors)

      const corpo = await lerJson(req, opcoes.limiteCorpoBytes)
      if (!corpo) return responder({ ok: false, codigo: 'CAMPOS_INVALIDOS' }, 200, cors)

      const resultado = await manipulador({
        ...clientes,
        funcao,
        usuarioId: data.user.id,
        corpo,
        origem: escolherOrigem(origem, origens),
      })
      return responder(resultado, 200, cors)
    } catch (e) {
      // Sem detalhes na resposta nem no log (nada de mensagem/stack: podem conter segredo).
      logErro(funcao, 'excecao', e)
      return responder({ ok: false, codigo: 'ERRO_INESPERADO' }, 200, cors)
    }
  }
}

/** Registra operação de sistema na auditoria (allowlist de ações no banco); falha vira log seguro. */
export async function registrar(
  ctx: Pick<Contexto, 'servico' | 'funcao'>,
  usuario: string,
  acao: string,
  alvo: string,
  resultado: 'OK' | 'NEGADO' | 'ERRO',
  codigo: string | null = null,
): Promise<void> {
  try {
    const { data, error } = await ctx.servico.rpc('sistema_registrar', {
      p_usuario: usuario,
      p_acao: acao,
      p_alvo: alvo,
      p_resultado: resultado,
      p_codigo: codigo,
    })
    if (error) logErro(ctx.funcao, `registrar:${acao}`, error)
    else if (!data?.ok) logErro(ctx.funcao, `registrar:${acao}`, { code: data?.codigo })
  } catch (e) {
    logErro(ctx.funcao, `registrar:${acao}`, e)
  }
}
