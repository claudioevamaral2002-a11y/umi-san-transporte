// Conversões de entrada e formatação de valores. Tudo por texto: nenhum valor financeiro passa por
// ponto flutuante (especificação 6). O front só converte o que a pessoa digitou para o formato do banco.

export const FUSO = 'America/Sao_Paulo'

const ESPACOS = /[\s\u00a0\u202f]+/g
/** Até 13 dígitos de reais: o total em centavos continua inteiro seguro (< 2^53). */
const MAX_DIGITOS_REAIS = 13

/**
 * "1.234,56" → 123456; "0,5" → 50; "10" → 1000; "R$ 12,30" → 1230; "12.50" → 1250.
 * Vírgula é o separador decimal; pontos só como milhar em grupos de 3. Texto inválido, negativo ou
 * com mais de 2 casas → `null`.
 */
export function reaisParaCentavos(texto: string): number | null {
  const s = texto.replace(/^\s*R\$/, '').replace(ESPACOS, '')
  let inteiro: string
  let fracao: string
  let m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s)
  if (m) {
    inteiro = m[1]!.replace(/\./g, '')
    fracao = m[2] ?? ''
  } else {
    // Teclado com ponto decimal ("12.5", "12.50"): só com 1 ou 2 casas, para não confundir com milhar.
    m = /^(\d+)\.(\d{1,2})$/.exec(s)
    if (!m) return null
    inteiro = m[1]!
    fracao = m[2]!
  }
  inteiro = inteiro.replace(/^0+(?=\d)/, '')
  if (inteiro.length > MAX_DIGITOS_REAIS) return null
  return Number.parseInt(inteiro + fracao.padEnd(2, '0'), 10)
}

/** 123456 → "1.234,56" (para preencher campos de edição). */
export function centavosParaTexto(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos < 0) throw new TypeError(`centavos inválidos: ${centavos}`)
  const reais = Math.floor(centavos / 100)
  const resto = centavos % 100
  return `${reais.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${resto.toString().padStart(2, '0')}`
}

/**
 * Percentual digitado → pontos-base: "12,5" → 1250; "50" → 5000; "0,01" → 1; "12.5" → 1250.
 * Aceita "%" no fim. Fora de 0–100% ou com mais de 2 casas → `null`.
 */
export function percentualParaBp(texto: string): number | null {
  const s = texto.replace(ESPACOS, '').replace(/%$/, '')
  const m = /^(\d{1,3})(?:[,.](\d{1,2}))?$/.exec(s)
  if (!m) return null
  const bp = Number.parseInt(m[1]! + (m[2] ?? '').padEnd(2, '0'), 10)
  return bp <= 10000 ? bp : null
}

/** 1250 → "12,5"; 5000 → "50"; 1 → "0,01". */
export function bpParaTexto(bp: number): string {
  if (!Number.isSafeInteger(bp) || bp < 0) throw new TypeError(`pontos-base inválidos: ${bp}`)
  const inteiro = Math.floor(bp / 100)
  const casas = (bp % 100).toString().padStart(2, '0').replace(/0+$/, '')
  return casas ? `${inteiro},${casas}` : `${inteiro}`
}

/** 1250 → "12,5%". */
export function formatarPercentual(bp: number): string {
  return `${bpParaTexto(bp)}%`
}

/** Inteiro positivo digitado (horas, dias): "12" → 12; vazio, zero, negativo ou fração → `null`. */
export function inteiroPositivo(texto: string, maximo = 2147483647): number | null {
  const s = texto.replace(ESPACOS, '')
  if (!/^\d{1,10}$/.test(s)) return null
  const n = Number.parseInt(s, 10)
  return n >= 1 && n <= maximo ? n : null
}

// ------------------------------------------------------------------------------------------------
// Datas no fuso de São Paulo (o app é usado no Brasil; o banco guarda timestamptz).
// ------------------------------------------------------------------------------------------------

const PARTES = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
})

function partes(data: Date) {
  const p = Object.fromEntries(PARTES.formatToParts(data).map((x) => [x.type, x.value]))
  const off = /GMT([+-])(\d{2}):(\d{2})/.exec(p.timeZoneName ?? '')
  const deslocamento = off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) : 0
  return { ano: p.year!, mes: p.month!, dia: p.day!, hora: p.hour!, minuto: p.minute!, deslocamento }
}

/** Instante → valor de `<input type="datetime-local">` no horário de São Paulo ("2026-10-08T14:30"). */
export function paraEntradaDataHora(data: Date): string {
  const p = partes(data)
  return `${p.ano}-${p.mes}-${p.dia}T${p.hora}:${p.minuto}`
}

/** "2026-10-08T14:30" (horário de São Paulo) → instante. Texto inválido → `null`. */
export function deEntradaDataHora(valor: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(valor)
  if (!m) return null
  const [ano, mes, dia, hora, minuto] = m.slice(1).map(Number) as [number, number, number, number, number]
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59) return null
  const comoUtc = Date.UTC(ano, mes - 1, dia, hora, minuto)
  // Duas passadas resolvem a troca de deslocamento (horário de verão, se voltar a existir).
  let instante = comoUtc - partes(new Date(comoUtc)).deslocamento * 60_000
  instante = comoUtc - partes(new Date(instante)).deslocamento * 60_000
  const data = new Date(instante)
  return paraEntradaDataHora(data) === valor ? data : null
}

/** Data de calendário ("2026-10-08") no início (ou fim) do dia em São Paulo. */
export function inicioDoDia(dia: string, fim = false): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null
  const inicio = deEntradaDataHora(`${dia}T00:00`)
  if (!inicio || !fim) return inicio
  return new Date(inicio.getTime() + 24 * 3600_000 - 1)
}

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'short' })
const DATA_LONGA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, weekday: 'long', day: 'numeric', month: 'long' })

/** "08/10/2026, 14:30" → sem vírgula: "08/10/2026 14:30". */
export function formatarDataHora(iso: string | Date): string {
  return DATA_HORA.format(typeof iso === 'string' ? new Date(iso) : iso).replace(',', '')
}

/** "Quinta-feira, 8 de outubro". */
export function formatarDataLonga(data: Date): string {
  const t = DATA_LONGA.format(data)
  return t.charAt(0).toUpperCase() + t.slice(1)
}
