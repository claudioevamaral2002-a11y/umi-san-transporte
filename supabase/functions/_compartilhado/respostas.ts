export type Corpo = { ok: boolean; codigo?: string; [campo: string]: unknown }

export function responder(corpo: Corpo, status = 200, extras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extras },
  })
}

export const LIMITE_CORPO_BYTES = 10_000

/** Lê o corpo como objeto JSON; `null` se vazio, grande demais, inválido ou não-objeto. */
export async function lerJson(req: Request): Promise<Record<string, unknown> | null> {
  const declarado = Number(req.headers.get('content-length') ?? '0')
  if (declarado > LIMITE_CORPO_BYTES) return null
  try {
    const texto = await req.text()
    if (texto.length > LIMITE_CORPO_BYTES) return null
    const valor: unknown = JSON.parse(texto)
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
