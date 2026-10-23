// Extrato: rótulos, valores com sinal (crédito/débito por sinal E por texto, nunca só pela cor), períodos prontos no
// fuso de São Paulo e exportação CSV (pt-BR: `;`, vírgula decimal, BOM UTF-8 para o Excel abrir com acentos).
import { formatarCentavos } from '../design/dinheiro.ts'
import type { ItemExtrato, TipoLancamento } from './saldo.ts'
import { hoje as hojeSp, mesDe, numeroPedido, somarDias, somarMeses } from './tempo.ts'
import { formatarDataHora, inicioDoDia } from './valores.ts'

export const ROTULO_TIPO: Record<TipoLancamento, string> = {
  RECARGA: 'Recarga',
  DEBITO: 'Débito do serviço',
  MULTA: 'Multa de cancelamento',
  ADITIVO: 'Aditivo',
  AJUSTE: 'Ajuste',
  ESTORNO: 'Estorno',
  RESERVA: 'Reserva',
  LIBERACAO_RESERVA: 'Liberação de reserva',
  PAGAMENTO_FATURA: 'Pagamento de fatura',
}

/** Tipos que o ADM pode estornar (o banco confere de novo). */
export const ESTORNAVEIS: readonly TipoLancamento[] = ['RECARGA', 'AJUSTE', 'DEBITO', 'MULTA', 'ADITIVO']

/** Efeito do lançamento no DISPONÍVEL (contábil − reservado): reserva tira, liberação devolve. */
export const efeitoDisponivel = (i: Pick<ItemExtrato, 'efeito_contabil_cent' | 'efeito_reservado_cent'>) =>
  i.efeito_contabil_cent - i.efeito_reservado_cent

export type Natureza = 'Crédito' | 'Débito' | 'Reservado' | 'Liberado' | 'Sem efeito'

export function natureza(i: Pick<ItemExtrato, 'tipo' | 'efeito_contabil_cent' | 'efeito_reservado_cent'>): Natureza {
  if (i.tipo === 'RESERVA') return 'Reservado'
  if (i.tipo === 'LIBERACAO_RESERVA') return 'Liberado'
  const e = efeitoDisponivel(i)
  return e > 0 ? 'Crédito' : e < 0 ? 'Débito' : 'Sem efeito'
}

/** 123456 → "+ R$ 1.234,56"; −5000 → "− R$ 50,00"; 0 → "R$ 0,00" (sinal de menos tipográfico). */
export function formatarComSinal(centavos: number): string {
  const base = formatarCentavos(Math.abs(centavos))
  return centavos > 0 ? `+ ${base}` : centavos < 0 ? `− ${base}` : base
}

/** Para planilhas: 123456 → "1.234,56"; −5000 → "-50,00" (hífen, que o Excel entende). */
export function valorPlanilha(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) throw new TypeError(`centavos inválidos: ${centavos}`)
  const abs = Math.abs(centavos)
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${centavos < 0 ? '-' : ''}${reais},${(abs % 100).toString().padStart(2, '0')}`
}

// ------------------------------------------------------------------------------------------------
// Períodos (São Paulo). `ate` é exclusivo (o banco filtra criado_em < ate).
// ------------------------------------------------------------------------------------------------

export type Preset = 'mes' | '7d' | '30d' | 'mes_anterior' | 'personalizado'

export const ROTULO_PRESET: Record<Preset, string> = {
  mes: 'Este mês',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  mes_anterior: 'Mês passado',
  personalizado: 'Escolher datas',
}

export interface Periodo {
  de: Date
  ate: Date
  /** Datas de calendário (inclusivas) para exibir e nomear arquivos. */
  diaDe: string
  diaAte: string
}

function periodoDeDias(diaDe: string, diaAte: string): Periodo | null {
  const de = inicioDoDia(diaDe)
  const ate = inicioDoDia(somarDias(diaAte, 1))
  if (!de || !ate || ate <= de) return null
  return { de, ate, diaDe, diaAte }
}

/** Período de um atalho (ou das datas escolhidas, inclusivas). Datas inválidas ou invertidas → `null`. */
export function periodoDe(preset: Preset, agora: Date, personalizado?: { de: string; ate: string }): Periodo | null {
  const hoje = hojeSp(agora)
  switch (preset) {
    case 'mes':
      return periodoDeDias(mesDe(hoje), hoje)
    case '7d':
      return periodoDeDias(somarDias(hoje, -6), hoje)
    case '30d':
      return periodoDeDias(somarDias(hoje, -29), hoje)
    case 'mes_anterior':
      return periodoDeDias(somarMeses(mesDe(hoje), -1), somarDias(mesDe(hoje), -1))
    case 'personalizado':
      return personalizado ? periodoDeDias(personalizado.de, personalizado.ate) : null
  }
}

/** "2026-10-01" → "01/10/2026". */
export const diaBr = (dia: string) => dia.split('-').reverse().join('/')

/** "extrato-umi-san-2026-10-01-a-2026-10-31" (sem acentos nem espaços). */
export function nomeArquivo(empresa: string, p: Pick<Periodo, 'diaDe' | 'diaAte'>): string {
  const slug =
    empresa
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'empresa'
  return `extrato-${slug}-${p.diaDe}-a-${p.diaAte}`
}

// ------------------------------------------------------------------------------------------------
// CSV
// ------------------------------------------------------------------------------------------------

/** Texto livre numa célula: aspas quando preciso e neutraliza fórmula (=, +, -, @) ao abrir no Excel. */
function celulaTexto(valor: string | null | undefined): string {
  let v = valor ?? ''
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Extrato em CSV para Excel pt-BR: BOM, `;`, CRLF, datas dd/mm/aaaa hh:mm e valores 1.234,56 com sinal. */
export function montarCsv(itens: readonly ItemExtrato[], opcoes: { adm?: boolean } = {}): string {
  const cab = [
    'Data',
    'Tipo',
    'Natureza',
    'Valor no disponível (R$)',
    'Efeito no saldo contábil (R$)',
    'Efeito no reservado (R$)',
    'Pedido',
    'Solicitante',
    ...(opcoes.adm ? ['Motivo', 'Comprovante', 'Lançado por'] : []),
  ]
  const linhas = itens.map((i) =>
    [
      formatarDataHora(i.criado_em),
      celulaTexto(ROTULO_TIPO[i.tipo] ?? i.tipo),
      natureza(i),
      valorPlanilha(efeitoDisponivel(i)),
      valorPlanilha(i.efeito_contabil_cent),
      valorPlanilha(i.efeito_reservado_cent),
      i.numero === null ? '' : numeroPedido(i.numero),
      celulaTexto(i.solicitante_nome),
      ...(opcoes.adm ? [celulaTexto(i.motivo), celulaTexto(i.comprovante), celulaTexto(i.criado_por_nome)] : []),
    ].join(';'),
  )
  return `\uFEFF${[cab.join(';'), ...linhas].join('\r\n')}\r\n`
}
