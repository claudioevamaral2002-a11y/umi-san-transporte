import { cabecalhosCors, escolherOrigem, origemPermitida, origensPermitidas } from './cors.ts'
import { criarClientes, origensConfiguradas, type Clientes } from './clientes.ts'
import { criarLimitador, extrairBearer, lerJson, responder, type Corpo } from './respostas.ts'

export interface Contexto extends Clientes {
  usuarioId: string
  corpo: Record<string, unknown>
  /** Origem do pedido (se permitida) ou a primeira configurada. */
  origem: string | null
}

const limitador = criarLimitador(20, 60_000)

/** Casca comum: método, CORS, JWT, limite por usuário e corpo JSON. Nunca devolve detalhes internos. */
export function criarServidor(manipulador: (ctx: Contexto) => Promise<Corpo>) {
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

      const corpo = await lerJson(req)
      if (!corpo) return responder({ ok: false, codigo: 'CAMPOS_INVALIDOS' }, 200, cors)

      const resultado = await manipulador({
        ...clientes,
        usuarioId: data.user.id,
        corpo,
        origem: escolherOrigem(origem, origens),
      })
      return responder(resultado, 200, cors)
    } catch {
      // Sem detalhes (nem stack, nem mensagem): o que falhou pode conter segredo.
      return responder({ ok: false, codigo: 'ERRO_INESPERADO' }, 200, cors)
    }
  }
}

/** Registra operação de sistema na auditoria (allowlist de ações no banco). */
export async function registrar(
  ctx: Pick<Contexto, 'servico'>,
  usuario: string,
  acao: string,
  alvo: string,
  resultado: 'OK' | 'NEGADO' | 'ERRO',
  codigo: string | null = null,
): Promise<void> {
  await ctx.servico.rpc('sistema_registrar', {
    p_usuario: usuario,
    p_acao: acao,
    p_alvo: alvo,
    p_resultado: resultado,
    p_codigo: codigo,
  })
}
