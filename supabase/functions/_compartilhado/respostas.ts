export type Corpo = { ok: boolean; codigo?: string; [campo: string]: unknown }

export function responder(corpo: Corpo, status = 200, extras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extras },
  })
}

export const LIMITE_CORPO_BYTES = 10_000

/**
 * Lê o corpo como objeto JSON, em fluxo: aborta ao passar de `limite` bytes, com ou sem Content-Length.
 * `null` se vazio, grande demais, Content-Length não numérico, JSON inválido ou não-objeto.
 */
export async function lerJson(req: Request, limite = LIMITE_CORPO_BYTES): Promise<Record<string, unknown> | null> {
  const declarado = req.headers.get('content-length')
  if (declarado !== null && (!/^[0-9]{1,15}$/.test(declarado.trim()) || Number(declarado) > limite)) return null
  if (!req.body) return null
  const leitor = req.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await leitor.read()
      if (done) break
      total += value.byteLength
      if (total > limite) {
        await leitor.cancel().catch(() => undefined)
        return null
      }
      partes.push(value)
    }
    const bytes = new Uint8Array(total)
    let posicao = 0
    for (const parte of partes) {
      bytes.set(parte, posicao)
      posicao += parte.byteLength
    }
    const valor: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return valor !== null && typeof valor === 'object' && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function extrairBearer(req: Request): string | null {
  const m = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(req.headers.get('authorization') ?? '')
  return m?.[1] ?? null
}

/** Limite em memória por chave (usuário) e por instância da função. */
export function criarLimitador(maximo: number, janelaMs: number, agora: () => number = () => Date.now()) {
  const registros = new Map<string, number[]>()
  return {
    permitir(chave: string): boolean {
      const t = agora()
      for (const [k, marcas] of registros) {
        if (marcas.every((m) => t - m >= janelaMs)) registros.delete(k)
      }
      const recentes = (registros.get(chave) ?? []).filter((m) => t - m < janelaMs)
      if (recentes.length >= maximo) {
        registros.set(chave, recentes)
        return false
      }
      recentes.push(t)
      registros.set(chave, recentes)
      return true
    },
  }
}
