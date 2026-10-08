const SEGURO = /^[A-Za-z0-9_.:-]{1,60}$/

function seguro(valor: unknown): string | number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor
  if (typeof valor === 'string' && SEGURO.test(valor)) return valor
  return null
}

/**
 * Registro de falha com contexto fixo: função, etapa e só nome/status/código do erro.
 * Nunca corpo, senha, link, JWT nem a mensagem (que pode carregá-los).
 */
export function logErro(funcao: string, etapa: string, erro?: unknown): void {
  const e = (typeof erro === 'object' && erro !== null ? erro : {}) as Record<string, unknown>
  console.error(
    JSON.stringify({ funcao, etapa, erro: seguro(e.name), status: seguro(e.status), codigo: seguro(e.code) }),
  )
}
