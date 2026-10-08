import { createClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteApi = ReturnType<typeof createClient<any, 'api', any>>

const opcoes = { db: { schema: 'api' }, auth: { persistSession: false, autoRefreshToken: false } } as const

function exigir(nome: string): string {
  const valor = Deno.env.get(nome)
  if (!valor) throw new Error(`configuração ausente: ${nome}`)
  return valor
}

export interface Clientes {
  /** Com o JWT do chamador: usado nas RPCs que autorizam. */
  usuario: ClienteApi
  /** Chave de serviço: Admin API e `api.sistema_*`. Nunca expor ao chamador. */
  servico: ClienteApi
}

export function criarClientes(jwt: string): Clientes {
  const url = exigir('SUPABASE_URL')
  return {
    usuario: createClient(url, exigir('SUPABASE_ANON_KEY'), {
      ...opcoes,
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    }),
    servico: createClient(url, exigir('SUPABASE_SERVICE_ROLE_KEY'), opcoes),
  }
}

export function origensConfiguradas(): string | undefined {
  return Deno.env.get('APP_ORIGENS')
}
