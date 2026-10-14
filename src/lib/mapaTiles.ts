/**
 * Fase 3A: blocos do mapa da Google Map Tiles API (2D, roadmap) para a folha "Marcar no mapa". A chave é de navegador,
 * restrita ao domínio do app e só a essa API (RUNBOOK §Google Maps). Nenhum script do Google entra na página: o Leaflet
 * desenha os blocos como imagens (CSP: só `tile.googleapis.com` em img-src e connect-src).
 */
const SESSAO_VALIDA = /^[A-Za-z0-9_-]{1,512}$/

export async function criarSessaoTiles(
  chave: string,
  buscar: typeof fetch = (...a) => fetch(...a),
): Promise<{ session: string; urlTile: string } | null> {
  if (!chave) return null
  const k = encodeURIComponent(chave)
  try {
    const r = await buscar(`https://tile.googleapis.com/v1/createSession?key=${k}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType: 'roadmap', language: 'pt-BR', region: 'BR' }),
    })
    if (!r.ok) return null
    const { session } = (await r.json()) as { session?: unknown }
    if (typeof session !== 'string' || !SESSAO_VALIDA.test(session)) return null
    return { session, urlTile: `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${session}&key=${k}` }
  } catch {
    return null
  }
}
