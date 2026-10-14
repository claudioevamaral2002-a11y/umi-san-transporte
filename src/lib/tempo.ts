// Datas, horários e contagens regressivas no fuso de São Paulo (o banco guarda timestamptz; o app é usado no Brasil).
// Funções puras: recebem o "agora" quando precisam dele (testáveis sem relógio).
import { FUSO, deEntradaDataHora } from './valores.ts'

const DIA = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })
const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const DIA_HORA_CURTO = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'short', day: 'numeric', month: 'short' })
const MES_ANO = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const DIA_LONGO = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
const DIA_MES = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'long' })

const comoData = (d: Date | string) => (typeof d === 'string' ? new Date(d) : d)
const DIA_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Instante → dia do calendário em São Paulo ("2026-10-09"). */
export function diaDe(instante: Date | string): string {
  return DIA.format(comoData(instante))
}

/** Instante → "14:30" em São Paulo. */
export function horaDe(instante: Date | string): string {
  return HORA.format(comoData(instante))
}

/** Hoje em São Paulo. */
export function hoje(agora: Date = new Date()): string {
  return diaDe(agora)
}

/** Data de calendário → instante UTC ao meio-dia (só para formatar o dia sem depender de fuso). */
function meioDia(dia: string): Date {
  const m = DIA_RE.exec(dia)
  if (!m) throw new TypeError(`dia inválido: ${dia}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
}

/** Primeiro dia do mês ("2026-10-01"). */
export function mesDe(dia: string): string {
  return `${dia.slice(0, 7)}-01`
}

/** Soma meses a um mês ("2026-12-01" + 1 → "2027-01-01"). */
export function somarMeses(mes: string, n: number): string {
  const d = meioDia(mes)
  const novo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1, 12))
  return novo.toISOString().slice(0, 10)
}

/** Soma dias a uma data de calendário. */
export function somarDias(dia: string, n: number): string {
  const d = meioDia(dia)
  return new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10)
}

/** "Outubro de 2026". */
export function nomeDoMes(mes: string): string {
  const t = MES_ANO.format(meioDia(mes))
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** "Sexta-feira, 9 de outubro". */
export function nomeDoDia(dia: string): string {
  const t = DIA_LONGO.format(meioDia(dia))
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const SEMANA_CURTA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' })

/** "Ter", "Sáb" (faixas de dias e colunas da agenda). */
export function diaDaSemanaCurto(dia: string): string {
  const t = SEMANA_CURTA.format(meioDia(dia)).replace('.', '')
  return t.charAt(0).toUpperCase() + t.slice(1, 3)
}

/** "9 de outubro". */
export function diaEMes(dia: string): string {
  return DIA_MES.format(meioDia(dia))
}

/**
 * Células do calendário do mês, semanas de domingo a sábado: `null` antes do dia 1 e depois do último dia
 * (o total é múltiplo de 7).
 */
export function gradeDoMes(mes: string): Array<string | null> {
  const primeiro = meioDia(mesDe(mes))
  const vazios = primeiro.getUTCDay()
  const ultimo = new Date(Date.UTC(primeiro.getUTCFullYear(), primeiro.getUTCMonth() + 1, 0, 12)).getUTCDate()
  const celulas: Array<string | null> = Array.from({ length: vazios }, () => null)
  for (let d = 1; d <= ultimo; d++) celulas.push(`${mes.slice(0, 7)}-${String(d).padStart(2, '0')}`)
  while (celulas.length % 7 !== 0) celulas.push(null)
  return celulas
}

/** Início do dia em São Paulo e início do dia seguinte (intervalo [de, ate) do dia). */
export function intervaloDoDia(dia: string): { de: Date; ate: Date } {
  const de = deEntradaDataHora(`${dia}T00:00`)
  const ate = deEntradaDataHora(`${somarDias(dia, 1)}T00:00`)
  if (!de || !ate) throw new TypeError(`dia inválido: ${dia}`)
  return { de, ate }
}

/** 120 → "2 h"; 150 → "2 h 30 min"; 30 → "30 min". */
export function formatarDuracao(minutos: number): string {
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/**
 * Tempo restante até `prazo`, para contagem regressiva (atualizada a cada minuto):
 * "2 dias 4 h", "1 dia", "3 h 5 min", "45 min", "menos de 1 min"; vencido → `null`.
 */
export function formatarContagem(prazo: Date | string, agora: Date = new Date()): string | null {
  const ms = comoData(prazo).getTime() - agora.getTime()
  if (ms <= 0) return null
  const minutos = Math.floor(ms / 60_000)
  if (minutos < 1) return 'menos de 1 min'
  const dias = Math.floor(minutos / 1440)
  const horas = Math.floor((minutos % 1440) / 60)
  const mins = minutos % 60
  if (dias > 0) {
    const d = dias === 1 ? '1 dia' : `${dias} dias`
    return horas > 0 ? `${d} ${horas} h` : d
  }
  if (horas > 0) return mins > 0 ? `${horas} h ${mins} min` : `${horas} h`
  return `${mins} min`
}

/** "sex., 9 de out. · 14:30". */
export function formatarQuando(instante: Date | string): string {
  return `${DIA_HORA_CURTO.format(comoData(instante))} · ${horaDe(instante)}`
}

/** "08:00–10:00". */
export function faixaHorario(inicio: Date | string, fim: Date | string): string {
  return `${horaDe(inicio)}–${horaDe(fim)}`
}

/** Fim de um bloco que começa em `inicio` e dura `minutos`. */
export function fimDe(inicio: Date | string, minutos: number): Date {
  return new Date(comoData(inicio).getTime() + minutos * 60_000)
}

export interface Janela {
  inicio: string
  fim: string
}

/**
 * Janelas livres a partir dos inícios livres de `api.horarios_livres(dia, passo)`: inícios consecutivos (de
 * `passo` em `passo` minutos) viram uma janela só, de [primeiro, último + passo).
 */
export function janelasLivres(inicios: string[], passoMin = 30): Janela[] {
  const passo = passoMin * 60_000
  const ordenados = [...inicios].map((i) => new Date(i).getTime()).sort((a, b) => a - b)
  const janelas: Array<{ ini: number; fim: number }> = []
  for (const t of ordenados) {
    const ultima = janelas.at(-1)
    if (ultima && t <= ultima.fim) ultima.fim = Math.max(ultima.fim, t + passo)
    else janelas.push({ ini: t, fim: t + passo })
  }
  return janelas.map((j) => ({ inicio: new Date(j.ini).toISOString(), fim: new Date(j.fim).toISOString() }))
}

/** Número legível do pedido: 42 → "#0042". */
export function numeroPedido(numero: number): string {
  return `#${String(numero).padStart(4, '0')}`
}
