// Cliente do Google Maps Platform para a função `enderecos` (fase 3A): URLs fixas (nada vindo do usuário vira URL além
// do place_id validado), tempo limite, campos mínimos (faixa Essentials) e token de sessão no autocompletar.
// A chave nunca sai na resposta. Antes de cada chamada ao Google, o uso passa pelo banco (limite e teto diário).
type Corpo = { ok: boolean; codigo?: string; [k: string]: unknown }
export type TipoUso = 'SUGERIR' | 'DETALHAR' | 'ROTA'
type Uso = (tipo: TipoUso) => Promise<{ ok: boolean; codigo?: string }>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PLACE = /^[A-Za-z0-9_-]{1,300}$/
const INVALIDO: Corpo = { ok: false, codigo: 'CAMPOS_INVALIDOS' }
const INDISPONIVEL: Corpo = { ok: false, codigo: 'MAPAS_INDISPONIVEL' }
const SEM_ROTA: Corpo = { ok: true, km: null, minutos: null }
// Viés para Santa Catarina.
const SC = { rectangle: { low: { latitude: -29.4, longitude: -53.9 }, high: { latitude: -25.9, longitude: -48.3 } } }

type Ponto = { lat: number; lng: number }
// Caixa aproximada do Brasil.
function noBrasil(p: unknown): p is Ponto {
  if (typeof p !== 'object' || p === null) return false
  const { lat, lng } = p as Record<string, unknown>
  return (
    typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -34 && lat <= 6 && lng >= -74 && lng <= -28
  )
}

const texto = (v: unknown, min: number, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length >= min && t.length <= max ? t : null
}

export function criarManipuladorEnderecos(deps: {
  chave: string | null
  buscar: typeof fetch
  registrarUso: Uso
  tempoLimiteMs?: number
  /** Registro de falhas do Google (só a ação e o status; nunca a chave nem o corpo). */
  log?: (etapa: string, detalhe: { status: number | null }) => void
}) {
  const chamar = async (url: string, init: RequestInit, mascara?: string, etapa = 'google'): Promise<unknown | null> => {
    const headers = new Headers(init.headers)
    headers.set('X-Goog-Api-Key', deps.chave!)
    headers.set('Content-Type', 'application/json')
    if (mascara) headers.set('X-Goog-FieldMask', mascara)
    try {
      const r = await deps.buscar(url, { ...init, headers, signal: AbortSignal.timeout(deps.tempoLimiteMs ?? 5000) })
      if (!r.ok) {
        deps.log?.(etapa, { status: r.status })
        return null
      }
      return await r.json()
    } catch {
      deps.log?.(etapa, { status: null })
      return null
    }
  }

  return async (c: Record<string, unknown>): Promise<Corpo> => {
    // 1. Entrada (antes de gastar qualquer chamada).
    let tipo: TipoUso
    if (c.acao === 'sugerir') {
      if (!texto(c.texto, 3, 120) || typeof c.sessao !== 'string' || !UUID.test(c.sessao)) return INVALIDO
      tipo = 'SUGERIR'
    } else if (c.acao === 'detalhar') {
      if (typeof c.place_id !== 'string' || !PLACE.test(c.place_id) || typeof c.sessao !== 'string' || !UUID.test(c.sessao)
          || !texto(c.nome, 1, 200)) return INVALIDO
      tipo = 'DETALHAR'
    } else if (c.acao === 'rota') {
      if (!noBrasil(c.origem) || !noBrasil(c.destino)) return INVALIDO
      tipo = 'ROTA'
    } else {
      return INVALIDO
    }

    // 2. Chave e uso (limite por pessoa e teto diário da empresa, no banco).
    if (!deps.chave) return INDISPONIVEL
    const uso = await deps.registrarUso(tipo)
    if (!uso.ok) return { ok: false, codigo: uso.codigo ?? 'LIMITE_EXCEDIDO' }

    // 3. Google.
    if (tipo === 'SUGERIR') {
      const r = (await chamar('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        body: JSON.stringify({
          input: texto(c.texto, 3, 120),
          sessionToken: c.sessao,
          includedRegionCodes: ['br'],
          languageCode: 'pt-BR',
          locationBias: SC,
        }),
      }, undefined, 'google:sugerir')) as {
        suggestions?: Array<{
          placePrediction?: { placeId?: string; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } }
        }>
      } | null
      if (!r) return INDISPONIVEL
      const sugestoes = (r.suggestions ?? [])
        .flatMap((s) => {
          const p = s.placePrediction
          const nome = p?.structuredFormat?.mainText?.text ?? ''
          if (!p?.placeId || !PLACE.test(p.placeId) || !nome) return []
          return [{ place_id: p.placeId, nome: nome.slice(0, 200), endereco: (p.structuredFormat?.secondaryText?.text ?? '').slice(0, 300) }]
        })
        .slice(0, 5)
      return { ok: true, sugestoes }
    }

    if (tipo === 'DETALHAR') {
      const r = (await chamar(
        `https://places.googleapis.com/v1/places/${c.place_id}?sessionToken=${c.sessao}&languageCode=pt-BR`,
        { method: 'GET' },
        'id,formattedAddress,location',
        'google:detalhar',
      )) as { id?: string; formattedAddress?: string; location?: { latitude?: number; longitude?: number } } | null
      const lat = r?.location?.latitude
      const lng = r?.location?.longitude
      if (typeof lat !== 'number' || typeof lng !== 'number') return INDISPONIVEL
      const id = typeof r?.id === 'string' && PLACE.test(r.id) ? r.id : (c.place_id as string)
      return {
        ok: true,
        local: { nome: texto(c.nome, 1, 200), endereco: r?.formattedAddress?.slice(0, 300) ?? null, lat, lng, place_id: id },
      }
    }

    // Rota: falha, tempo esgotado ou nenhuma rota de carro viram km null (o pedido segue sem prévia).
    const o = c.origem as Ponto
    const d = c.destino as Ponto
    const r = (await chamar(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        method: 'POST',
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
          destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
          travelMode: 'DRIVE',
          languageCode: 'pt-BR',
          units: 'METRIC',
        }),
      },
      'routes.distanceMeters,routes.duration',
      'google:rota',
    )) as { routes?: Array<{ distanceMeters?: number; duration?: string }> } | null
    const rota = r?.routes?.[0]
    if (!rota?.distanceMeters || rota.distanceMeters <= 0) return SEM_ROTA
    const km = Math.round(rota.distanceMeters / 100) / 10
    if (km > 5000) return SEM_ROTA
    const segundos = Number.parseInt(rota.duration ?? '', 10)
    return { ok: true, km, minutos: Number.isFinite(segundos) ? Math.round(segundos / 60) : null }
  }
}
