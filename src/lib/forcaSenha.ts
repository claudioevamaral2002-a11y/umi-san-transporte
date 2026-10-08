// Espelha as regras do servidor (supabase/functions/_compartilhado/senha.ts) só para guiar a pessoa;
// quem decide é a Edge Function (inclusive a checagem de vazamento).
export const SENHA_MINIMO = 10
export const SENHA_MAXIMO_BYTES = 72

export function normalizarSenha(senha: string): string {
  return senha.normalize('NFC')
}

export interface Regra {
  id: 'tamanho' | 'maiuscula' | 'minuscula' | 'numero'
  rotulo: string
  ok: boolean
}

export interface AvaliacaoSenha {
  regras: Regra[]
  /** Passa em todas as regras locais e cabe em 72 bytes. */
  valida: boolean
  longaDemais: boolean
  /** 0–4, para o medidor. */
  nivel: number
}

export function avaliarSenha(bruta: string): AvaliacaoSenha {
  const senha = normalizarSenha(bruta)
  const regras: Regra[] = [
    { id: 'tamanho', rotulo: `Pelo menos ${SENHA_MINIMO} caracteres`, ok: [...senha].length >= SENHA_MINIMO },
    { id: 'maiuscula', rotulo: 'Uma letra maiúscula', ok: /\p{Lu}/u.test(senha) },
    { id: 'minuscula', rotulo: 'Uma letra minúscula', ok: /\p{Ll}/u.test(senha) },
    { id: 'numero', rotulo: 'Um número', ok: /\p{Nd}/u.test(senha) },
  ]
  const longaDemais = new TextEncoder().encode(senha).length > SENHA_MAXIMO_BYTES
  const nivel = regras.filter((r) => r.ok).length
  return { regras, valida: nivel === regras.length && !longaDemais, longaDemais, nivel }
}
