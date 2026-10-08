export const SENHA_MINIMO = 10
/** O bcrypt do Auth ignora o que passa de 72 bytes. */
export const SENHA_MAXIMO_BYTES = 72

/** O front deve normalizar do mesmo jeito (NFC) antes de enviar e ao entrar. */
export function normalizarSenha(senha: string): string {
  return senha.normalize('NFC')
}

/** Regras de força (>= 10, maiúscula, minúscula e número). Devolve o código da recusa ou `null` se passou. */
export function validarForcaSenha(senha: unknown): 'SENHA_FRACA' | 'SENHA_LONGA' | null {
  if (typeof senha !== 'string') return 'SENHA_FRACA'
  if (new TextEncoder().encode(senha).length > SENHA_MAXIMO_BYTES) return 'SENHA_LONGA'
  if ([...senha].length < SENHA_MINIMO) return 'SENHA_FRACA'
  // Classes ASCII, iguais às do Auth (`lower_upper_letters_digits`); outros caracteres continuam permitidos.
  if (!/[A-Z]/.test(senha) || !/[a-z]/.test(senha) || !/[0-9]/.test(senha)) return 'SENHA_FRACA'
  return null
}
