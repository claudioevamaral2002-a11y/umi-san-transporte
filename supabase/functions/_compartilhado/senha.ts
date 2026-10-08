export const SENHA_MINIMO = 10
/** O bcrypt do Auth ignora o que passa de 72 bytes. */
export const SENHA_MAXIMO_BYTES = 72

/** Regras de força (>= 10, maiúscula, minúscula e número). Devolve `SENHA_FRACA` ou `null` se passou. */
export function validarForcaSenha(senha: unknown): 'SENHA_FRACA' | null {
  if (typeof senha !== 'string') return 'SENHA_FRACA'
  if ([...senha].length < SENHA_MINIMO) return 'SENHA_FRACA'
  if (new TextEncoder().encode(senha).length > SENHA_MAXIMO_BYTES) return 'SENHA_FRACA'
  if (!/\p{Lu}/u.test(senha) || !/\p{Ll}/u.test(senha) || !/\p{Nd}/u.test(senha)) return 'SENHA_FRACA'
  return null
}
