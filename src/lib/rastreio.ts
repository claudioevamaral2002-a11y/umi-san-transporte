// Fase 3B (docs/fases/fase-3b-desenho-execucao-rastreio.md §2.4): regras puras do rastreio, sem React nem rede.
//   motorista: quando enviar a posição (a cada 5 s ou 50 m; parado, sinal de vida a cada 30 s; precisão até 100 m),
//              quando recalcular a chegada e para onde (ida e volta troca para a origem a 150 m do destino);
//   cliente:   "a última vence" pelo seq, interpolação do carro entre dois pontos e o estado do sinal (20 s / 60 s).

export interface Ponto {
  lat: number
  lng: number
}

export interface Leitura extends Ponto {
  /** Metros (GeolocationCoordinates.accuracy). */
  precisao: number
  rumo?: number | null
  velocidade?: number | null
}

export interface Posicao extends Ponto {
  seq: number
  /** Quando chegou na tela (ms). */
  recebidaEm: number
  rumo?: number | null
  eta?: string | null
}

export const AMOSTRAGEM = {
  intervaloMs: 5_000,
  distanciaM: 50,
  paradoMs: 60_000,
  batimentoMs: 30_000,
  precisaoMaxM: 100,
} as const

export const SINAL = { atrasadoMs: 20_000, perdidoMs: 60_000 } as const

/** Distância em metros (haversine), a mesma conta do banco (interno.distancia_m). */
export function distanciaM(a: Ponto, b: Ponto): number {
  const rad = (g: number) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

/**
 * Decide, leitura a leitura do GPS, se a posição vai para o servidor. Descarta leitura imprecisa; envia na primeira,
 * depois de 5 s, ou antes se andou 50 m; parado há mais de 60 s, só um sinal de vida a cada 30 s.
 */
export function criarAmostrador(c = AMOSTRAGEM) {
  let ultimoEnvio: { em: number; ponto: Ponto } | null = null
  let ultimoMovimento = 0
  return {
    deveEnviar(l: Leitura, agora: number): boolean {
      if (!Number.isFinite(l.lat) || !Number.isFinite(l.lng) || !(l.precisao <= c.precisaoMaxM)) return false
      if (!ultimoEnvio) {
        ultimoEnvio = { em: agora, ponto: l }
        ultimoMovimento = agora
        return true
      }
      const andou = distanciaM(ultimoEnvio.ponto, l)
      if (andou >= c.distanciaM) ultimoMovimento = agora
      const parado = agora - ultimoMovimento > c.paradoMs
      const decorrido = agora - ultimoEnvio.em
      const enviar = parado ? decorrido >= c.batimentoMs : andou >= c.distanciaM || decorrido >= c.intervaloMs
      if (enviar) ultimoEnvio = { em: agora, ponto: l }
      return enviar
    },
  }
}

/** Payload do canal (dado de terceiros) → posição válida, ou `null` se algum campo não confere. */
export function comoPosicao(payload: unknown, agora: number): Posicao | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const lat = num(p.lat)
  const lng = num(p.lng)
  const seq = num(p.seq)
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const eta = typeof p.eta === 'string' && !Number.isNaN(Date.parse(p.eta)) ? p.eta : null
  return { lat, lng, seq: seq ?? 0, recebidaEm: agora, rumo: num(p.rumo), eta }
}

/** "A última vence": posição com seq menor ou igual ao da atual é ignorada (chegou fora de ordem). */
export function aplicarPosicao(atual: Posicao | null, nova: Posicao): Posicao {
  return atual && nova.seq <= atual.seq ? atual : nova
}

/** Ponto entre `de` e `para` na fração `t` (0 a 1) do caminho: o carro anda em vez de pular. */
export function interpolar(de: Ponto, para: Ponto, t: number): Ponto {
  const f = Math.min(1, Math.max(0, t))
  return { lat: de.lat + (para.lat - de.lat) * f, lng: de.lng + (para.lng - de.lng) * f }
}

export type EstadoSinal = 'aguardando' | 'ao_vivo' | 'atrasado' | 'perdido'

/** Sem posição ainda: aguardando; até 20 s: ao vivo; até 60 s: atrasado ("atualizado há X s"); depois: perdido. */
export function estadoDoSinal(ultimaEm: number | null, agora: number): EstadoSinal {
  if (ultimaEm === null) return 'aguardando'
  const idade = agora - ultimaEm
  if (idade > SINAL.perdidoMs) return 'perdido'
  if (idade > SINAL.atrasadoMs) return 'atrasado'
  return 'ao_vivo'
}

export const ETA = { intervaloMs: 10 * 60_000, chegadaM: 150 } as const

/**
 * Recalcula a chegada (rota no Google) na saída, quando o destino muda (ida e volta) e a cada 10 min. Entre um cálculo
 * e outro, a chegada é um horário fixo: a tela só desconta o tempo que passou.
 */
export function precisaRecalcularEta(
  ultimo: { em: number; destino: 'destino' | 'origem' } | null,
  destinoAtual: 'destino' | 'origem',
  agora: number,
): boolean {
  return !ultimo || ultimo.destino !== destinoAtual || agora - ultimo.em >= ETA.intervaloMs
}

/** Ida e volta: depois de passar a 150 m do destino, o próximo alvo é a origem. Trecho único: sempre o destino. */
export function alvoDaViagem(
  idaEVolta: boolean,
  jaChegouNoDestino: boolean,
): 'destino' | 'origem' {
  return idaEVolta && jaChegouNoDestino ? 'origem' : 'destino'
}

export function chegou(posicao: Ponto, alvo: Ponto | null): boolean {
  return alvo !== null && distanciaM(posicao, alvo) <= ETA.chegadaM
}

/** Minutos que faltam até a chegada prevista (nunca negativo); `null` sem previsão. */
export function minutosAte(chegadaIso: string | null | undefined, agora: number): number | null {
  if (!chegadaIso) return null
  const t = Date.parse(chegadaIso)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((t - agora) / 60_000))
}
