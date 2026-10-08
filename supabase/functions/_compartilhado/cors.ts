/** Lista de origens permitidas a partir de `APP_ORIGENS` (separadas por vírgula). */
export function origensPermitidas(bruto: string | undefined): string[] {
  return (bruto ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o !== '')
}

export function origemPermitida(origem: string | null, lista: string[]): boolean {
  return origem !== null && lista.includes(origem)
}

/** Origem usada em links gerados: a do pedido, se permitida; senão a primeira configurada. */
export function escolherOrigem(origem: string | null, lista: string[]): string | null {
  if (origem !== null && origemPermitida(origem, lista)) return origem
  return lista[0] ?? null
}

export function cabecalhosCors(origem: string | null, lista: string[]): Record<string, string> {
  if (origem === null || !origemPermitida(origem, lista)) return {}
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}
