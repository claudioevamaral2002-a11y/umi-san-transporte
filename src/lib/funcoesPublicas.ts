import { criarChamadorPublico } from './chamarFuncao.ts'

/** Edge Functions sem sessão (ex.: `resgatar-link`). Não carrega o cliente Supabase. */
export const chamarFuncaoPublica = criarChamadorPublico({
  url: import.meta.env.VITE_SUPABASE_URL,
  chavePublica: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
})
