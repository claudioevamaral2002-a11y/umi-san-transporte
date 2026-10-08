import { createClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteApi = ReturnType<typeof createClient<any, 'api', any>>

const opcoes = { db: { schema: 'api' }, auth: { persistSession: false, autoRefreshToken: false } } as const

function exigir(nome: string): string {
  const valor = Deno.env.get(nome)
  if (!valor) throw new Error(`configuração ausente: ${nome}`)
  return valor
}

/**
 * Primeira chave de uma lista injetada pelo Supabase. Suposição documentada: além das variáveis legadas
 * (SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY), a plataforma pode injetar SUPABASE_PUBLISHABLE_KEYS e
 * SUPABASE_SECRET_KEYS como JSON (objeto nome->chave ou lista); aceitamos também lista separada por vírgula.
 */
function primeiraChave(nome: string): string | undefined {
  const bruto = Deno.env.get(nome)?.trim()
  if (!bruto) return undefined
  try {
    const dado: unknown = JSON.parse(bruto)
    const itens = Array.isArray(dado) ? dado : dado && typeof dado === 'object' ? Object.values(dado) : [dado]
    const chave = itens.find((x): x is string => typeof x === 'string' && x.length > 0)
    if (chave) return chave
  } catch {
    // não é JSON: tenta lista separada por vírgula
  }
  return bruto.split(',').map((x) => x.trim()).find(Boolean)
}

function chave(legada: string, lista: string): string {
  const valor = Deno.env.get(legada) || primeiraChave(lista)
  if (!valor) throw new Error('configuração ausente')
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
    usuario: createClient(url, chave('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS'), {
      ...opcoes,
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    }),
    servico: createClient(url, chave('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS'), opcoes),
  }
}

export function origensConfiguradas(): string | undefined {
  return Deno.env.get('APP_ORIGENS')
}
