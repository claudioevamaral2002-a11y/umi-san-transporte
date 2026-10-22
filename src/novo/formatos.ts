// Textos curtos do app novo (pedido estilo Uber): dia e hora no fuso de São Paulo e valores sem casas quando inteiros.
// Só formatação: os valores vêm sempre do banco.
import { formatarCentavos } from '../design/dinheiro.ts'
import { diaDe, horaDe, somarDias } from '../lib/tempo.ts'
import { FUSO } from '../lib/valores.ts'

const SEMANA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'short' })
const DIA_MES = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' })
const REAIS_INTEIROS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

const comoData = (d: Date | string) => (typeof d === 'string' ? new Date(d) : d)

/** "qua", "sáb". */
export function semanaCurta(instante: Date | string): string {
  return SEMANA.format(comoData(instante)).replace('.', '').toLowerCase().slice(0, 3)
}

/** "qua 22/10". */
export function diaCurto(instante: Date | string): string {
  return `${semanaCurta(instante)} ${DIA_MES.format(comoData(instante))}`
}

/** "qua 22/10, 08:30" (o seletor "Agendar" e o resumo do pedido). */
export function quandoCompleto(instante: Date | string): string {
  return `${diaCurto(instante)}, ${horaDe(instante)}`
}

/** "qua 08:30" (o botão "Pedir {categoria} · {dia hh:mm}"). */
export function quandoCurto(instante: Date | string): string {
  return `${semanaCurta(instante)} ${horaDe(instante)}`
}

/** Prazo da resposta: "hoje, 12:04", "amanhã, 08:00" ou "qua 22/10, 08:00". */
export function prazoAte(instante: Date | string, agora: Date): string {
  const dia = diaDe(instante)
  const hoje = diaDe(agora)
  if (dia === hoje) return `hoje, ${horaDe(instante)}`
  if (dia === somarDias(hoje, 1)) return `amanhã, ${horaDe(instante)}`
  return quandoCompleto(instante)
}

/** "R$ 180" quando o valor é inteiro; "R$ 180,50" quando tem centavos (nunca arredonda dinheiro). */
export function reaisCurto(centavos: number): string {
  return centavos % 100 === 0 ? REAIS_INTEIROS.format(centavos / 100) : formatarCentavos(centavos)
}

/** "MS" para "Marina Souza"; "I" para "Ivo". */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  const primeira = partes[0]?.[0] ?? ''
  const ultima = partes.length > 1 ? (partes.at(-1)?.[0] ?? '') : ''
  return `${primeira}${ultima}`.toUpperCase()
}

/** "42 km" / "38,5 km". */
export function formatarKm(km: number): string {
  return `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`
}
