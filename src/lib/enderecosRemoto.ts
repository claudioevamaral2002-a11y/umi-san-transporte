import { juntarSugestoes, type Local, type Sugestao, type SugestaoGoogle } from './enderecos.ts'
import { chamarFuncao } from './funcoes.ts'
import { supabase } from './supabase.ts'
import { pontoDaRota, type PontoRota } from './pontoRota.ts'

/**
 * Fase 3A: chamadas reais da busca de endereços. Locais da empresa vêm do banco (sem custo, sempre frescos: nunca da
 * memória das consultas, para a conta trocada no aparelho não ver locais de outra empresa); o resto vem da função
 * `enderecos`, que guarda a chave do Google. Qualquer falha do Google vira `indisponivel` e o campo cai no texto livre.
 */

export type ResultadoBusca = { sugestoes: Sugestao[]; indisponivel: boolean }

const MINIMO_GOOGLE = 3

function comoLocal(x: unknown): Local | null {
  if (!x || typeof x !== 'object') return null
  const l = x as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const lat = num(l.lat)
  const lng = num(l.lng)
  const place = typeof l.place_id === 'string' ? l.place_id : null
  // Local do Google: basta o place_id. Ponto marcado no mapa: precisa das coordenadas.
  if (typeof l.nome !== 'string' || (!place && (lat === null || lng === null))) return null
  return {
    nome: l.nome,
    endereco: typeof l.endereco === 'string' ? l.endereco : null,
    lat,
    lng,
    place_id: typeof l.place_id === 'string' ? l.place_id : null,
  }
}

async function locaisDaEmpresa(texto: string): Promise<Local[]> {
  try {
    const { data, error } = await supabase.rpc('locais_da_empresa', { p_texto: texto.slice(0, 120) })
    if (error || !data?.ok || !Array.isArray(data.locais)) return []
    return (data.locais as unknown[]).map(comoLocal).filter((l): l is Local => l !== null)
  } catch {
    return []
  }
}

/** Locais da empresa (desde 0 letras) e, com 3 letras ou mais, as sugestões do Google na mesma sessão. */
export async function buscarSugestoes(texto: string, sessao: string): Promise<ResultadoBusca> {
  const t = texto.trim()
  const [locais, google] = await Promise.all([
    locaisDaEmpresa(t),
    t.length >= MINIMO_GOOGLE ? chamarFuncao('enderecos', { acao: 'sugerir', texto: t, sessao }) : null,
  ])
  if (google && !google.ok) return { sugestoes: juntarSugestoes(locais, []), indisponivel: true }
  const lista = google && Array.isArray(google.sugestoes) ? (google.sugestoes as SugestaoGoogle[]) : []
  return { sugestoes: juntarSugestoes(locais, lista), indisponivel: false }
}

/** Coordenadas e endereço formatado da sugestão escolhida (fecha a sessão de busca no Google). */
export async function detalhar(placeId: string, nome: string, sessao: string): Promise<Local | null> {
  const r = await chamarFuncao('enderecos', { acao: 'detalhar', place_id: placeId, nome, sessao })
  return r.ok ? comoLocal(r.local) : null
}

// v2.2: a regra fica em `pontoRota.ts` (sem importações); daqui só é reexportada para quem já importava daqui.
export { pontoDaRota, type Coordenada, type PontoRota } from './pontoRota.ts'

/** Chamada única da ação `rota`: km, minutos e a linha codificada (cada um `null` quando ausente). `null` se a chamada falhou. */
export async function consultarRota(
  origem: PontoRota,
  destino: PontoRota,
  paradas?: PontoRota[],
): Promise<{ km: number | null; minutos: number | null; polyline: string | null } | null> {
  const r = await chamarFuncao('enderecos', { acao: 'rota', origem, destino, ...(paradas && paradas.length > 0 ? { paradas } : {}) })
  if (!r.ok) return null
  const km = typeof r.km === 'number' ? r.km : null
  return {
    km,
    minutos: km !== null && typeof r.minutos === 'number' ? r.minutos : null,
    polyline: typeof r.polyline === 'string' && r.polyline.length > 0 ? r.polyline : null,
  }
}

/** Distância e tempo da rota de carro (calculados na hora, nunca guardados); `null` sem rota ou com o Google fora. */
export async function rota(
  o: Pick<Local, 'lat' | 'lng' | 'place_id'>,
  d: Pick<Local, 'lat' | 'lng' | 'place_id'>,
): Promise<{ km: number | null; minutos: number | null }> {
  const origem = pontoDaRota(o)
  const destino = pontoDaRota(d)
  if (!origem || !destino) return { km: null, minutos: null }
  const r = await consultarRota(origem, destino)
  return { km: r?.km ?? null, minutos: r?.minutos ?? null }
}
