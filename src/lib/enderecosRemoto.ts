import { juntarSugestoes, type Local, type Sugestao, type SugestaoGoogle } from './enderecos.ts'
import { chamarFuncao } from './funcoes.ts'
import { supabase } from './supabase.ts'

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
  const lat = Number(l.lat)
  const lng = Number(l.lng)
  if (typeof l.nome !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
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

/** Distância e tempo da rota de carro; `null` nos dois quando não há rota ou o Google falhou. */
export async function rota(o: Local, d: Local): Promise<{ km: number | null; minutos: number | null }> {
  const r = await chamarFuncao('enderecos', {
    acao: 'rota',
    origem: { lat: o.lat, lng: o.lng },
    destino: { lat: d.lat, lng: d.lng },
  })
  const km = r.ok && typeof r.km === 'number' ? r.km : null
  return { km, minutos: km !== null && typeof r.minutos === 'number' ? r.minutos : null }
}
