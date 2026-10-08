export type RespostaFuncao = { ok: boolean; codigo?: string; [campo: string]: unknown }

export interface OpcoesChamador {
  url: string
  chavePublica: string
  /** Access token da sessão corrente (ou `null` sem sessão). */
  obterToken: () => Promise<string | null>
  buscar?: typeof fetch
}

/**
 * Chamada das Edge Functions: POST JSON em `${url}/functions/v1/<nome>` com o JWT do usuário.
 * Sempre devolve `{ok, codigo}`; rede/resposta estranha vira `ERRO_INESPERADO`.
 */
export function criarChamador({ url, chavePublica, obterToken, buscar = (...a) => fetch(...a) }: OpcoesChamador) {
  return criar({ url, chavePublica, obterToken, buscar, exigeToken: true })
}

/** Mesma chamada, sem sessão (só `apikey`): usada pelo resgate do link de acesso. */
export function criarChamadorPublico({
  url,
  chavePublica,
  buscar = (...a) => fetch(...a),
}: Omit<OpcoesChamador, 'obterToken'>) {
  return criar({ url, chavePublica, obterToken: async () => null, buscar, exigeToken: false })
}

function criar({
  url,
  chavePublica,
  obterToken,
  buscar,
  exigeToken,
}: Required<OpcoesChamador> & { exigeToken: boolean }) {
  const base = url.replace(/\/+$/, '')
  return async function chamar(nome: string, corpo: Record<string, unknown>): Promise<RespostaFuncao> {
    try {
      const token = exigeToken ? await obterToken() : null
      if (exigeToken && !token) return { ok: false, codigo: 'NAO_AUTENTICADO' }
      const resposta = await buscar(`${base}/functions/v1/${encodeURIComponent(nome)}`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          apikey: chavePublica,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(corpo),
      })
      const dados: unknown = await resposta.json().catch(() => null)
      if (dados && typeof dados === 'object' && typeof (dados as RespostaFuncao).ok === 'boolean') {
        const r = dados as RespostaFuncao
        if (r.ok) return r
        return { ...r, codigo: typeof r.codigo === 'string' ? r.codigo : 'ERRO_INESPERADO' }
      }
      return { ok: false, codigo: resposta.status === 401 ? 'NAO_AUTENTICADO' : 'ERRO_INESPERADO' }
    } catch {
      return { ok: false, codigo: 'ERRO_INESPERADO' }
    }
  }
}
