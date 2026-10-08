import { criarChamador } from './chamarFuncao.ts'
import { supabase } from './supabase.ts'

export type { RespostaFuncao } from './chamarFuncao.ts'

/** `chamarFuncao('definir-senha', { senha })` → `{ ok, codigo }`. */
export const chamarFuncao = criarChamador({
  url: import.meta.env.VITE_SUPABASE_URL,
  chavePublica: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  obterToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
})
