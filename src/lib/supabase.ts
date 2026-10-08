import { createClient } from '@supabase/supabase-js'

// Só a chave pública (publishable). Nenhuma outra chave vai para o navegador.
// Carregado sob demanda (import dinâmico na sessão) para manter a carga inicial no orçamento.
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  db: { schema: 'api' },
  auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
})
