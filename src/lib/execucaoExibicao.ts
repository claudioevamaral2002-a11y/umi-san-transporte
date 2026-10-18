// Fase 3B: contas só de exibição da execução (links de navegação, opções da nova previsão, duração real).
import type { PontoDoPedido } from './viagem.ts'

const QUINZE_MIN = 15 * 60_000

/** "Abrir no Maps": rota até o ponto pelo place_id (com o nome) ou pelas coordenadas do ponto marcado. */
export function linkGoogleMaps(p: PontoDoPedido): string {
  const u = new URLSearchParams({ api: '1', travelmode: 'driving' })
  if (p.lat !== null && p.lng !== null && !p.place_id) u.set('destination', `${p.lat},${p.lng}`)
  else u.set('destination', p.nome)
  if (p.place_id) u.set('destination_place_id', p.place_id)
  return `https://www.google.com/maps/dir/?${u.toString()}`
}

/** Waze: coordenadas quando houver; senão, a busca pelo nome. */
export function linkWaze(p: PontoDoPedido): string {
  if (p.lat !== null && p.lng !== null) return `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`
  return `https://waze.com/ul?q=${encodeURIComponent(p.nome)}&navigate=yes`
}

/** 8 horários em passos de 15 min, a partir do primeiro quarto de hora depois de agora + 5 min (até 2 h à frente). */
export function opcoesDePrevisao(agora: number, quantas = 8): string[] {
  const primeiro = Math.ceil((agora + 5 * 60_000) / QUINZE_MIN) * QUINZE_MIN
  return Array.from({ length: quantas }, (_, i) => new Date(primeiro + i * QUINZE_MIN).toISOString())
}

/** Minutos entre a saída e a conclusão (ou agora, em andamento); `null` sem saída. */
export function minutosDeViagem(saiu: string | null | undefined, fim: string | null | undefined, agora: number): number | null {
  if (!saiu) return null
  const ini = Date.parse(saiu)
  const ate = fim ? Date.parse(fim) : agora
  if (Number.isNaN(ini) || Number.isNaN(ate)) return null
  return Math.max(0, Math.round((ate - ini) / 60_000))
}

/** "~41 km" com uma casa quando for menos de 10 km. */
export function formatarKm(km: number | null | undefined): string | null {
  if (km === null || km === undefined) return null
  return `~${km < 10 ? km.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : Math.round(km).toLocaleString('pt-BR')} km`
}
