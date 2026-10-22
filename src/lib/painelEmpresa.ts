// Fase 4 (especificação §6.9): "Painel da empresa" do Administrador (N1) e do Master (ADM), no computador. Uma leitura
// só, `api.painel_empresa`, devolve os blocos (resumo do mês, próximas corridas, recentes, pessoas) e as corridas do mês
// para o CSV. Só formatação aqui: todo valor vem do banco (livro-razão e orçamentos).
import type { Status } from '../design/componentes/StatusBadge.tsx'
import { ler } from './pedidos.ts'
import { FUSO } from './valores.ts'

export interface PedidoPainel {
  id: string
  numero: number
  solicitante_nome: string | null
  inicio: string
  fim_previsto: string
  origem: string
  destino: string
  /** Paradas entre a origem e o destino, na ordem (fase 4.1). */
  paradas?: string[] | null
  /** Horas estimadas do pedido, de 0,5 a 24 (fase 4.1). */
  horas_estimadas?: number | null
  categoria_nome: string | null
  centro_custo: string | null
  status: Status
  /** Orçamento aprovado, senão o pendente; no cancelado, a multa. Nulo = sem valor. */
  valor_cent: number | null
  /** Sem valor ainda, num pedido que ainda vai acontecer (a tela mostra "a orçar"). */
  estimado: boolean
}

export interface ResumoPainel {
  /** "2026-10-01" */
  mes: string
  gasto_cent: number
  reservado_cent: number
  disponivel_cent: number
  /** Saldo no 1º dia + recargas do mês + limite de crédito do contrato. */
  total_mes_cent: number
  contato_recarga: string | null
}

export interface Painel {
  resumo: ResumoPainel
  proximas: PedidoPainel[]
  recentes: PedidoPainel[]
  /** Corridas do mês que podem ter cobrança (em andamento, concluídas e canceladas), para o CSV. */
  do_mes: PedidoPainel[]
  pessoas: { sem_corridas: number; convites_pendentes: number }
}

export type RotuloStatus =
  | 'Aguardando o Ivo'
  | 'Para confirmar'
  | 'Agendada'
  | 'A caminho'
  | 'Concluída'
  | 'Cancelada'
  | 'Recusada'
  | 'Reprovada'
  | 'Expirada'

const ROTULOS: Record<Status, RotuloStatus> = {
  SOLICITADA: 'Aguardando o Ivo',
  ORCADA: 'Para confirmar',
  AGENDADA: 'Agendada',
  EM_ANDAMENTO: 'A caminho',
  CONCLUIDA: 'Concluída',
  CANCELADA: 'Cancelada',
  RECUSADA: 'Recusada',
  REPROVADA: 'Reprovada',
  EXPIRADA: 'Expirada',
}

/** Rótulo da situação no painel (mais curto que o do app de hoje). */
export function rotuloStatus(status: Status): RotuloStatus {
  return ROTULOS[status]
}

export const CABECALHO_CSV = 'Data;Quem pediu;De;Paradas;Para;Categoria;Horas;Centro de custo;Valor'

const DATA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' })
const HORAS = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1, useGrouping: false })
const VALOR = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })

/** Campo do CSV: aspas quando há `;`, aspas ou quebra de linha; apóstrofo antes do que a planilha leria como fórmula. */
function campo(texto: string | null): string {
  let t = texto ?? ''
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

/** CSV do mês (separador `;`, como o Excel em português abre), uma corrida com valor por linha. */
export function csvDoMes(itens: readonly PedidoPainel[]): string {
  const linhas = itens
    .filter((i) => i.valor_cent !== null)
    .map((i) =>
      [
        DATA.format(new Date(i.inicio)),
        campo(i.solicitante_nome),
        campo(i.origem),
        campo((i.paradas ?? []).join(' | ')),
        campo(i.destino),
        campo(i.categoria_nome),
        i.horas_estimadas == null ? '' : HORAS.format(i.horas_estimadas),
        campo(i.centro_custo),
        VALOR.format((i.valor_cent ?? 0) / 100),
      ].join(';'),
    )
  return [CABECALHO_CSV, ...linhas].map((l) => `${l}\r\n`).join('')
}

export const painelEmpresa = {
  /** O N1 passa nada (o banco usa a empresa dele); o ADM passa a empresa. `mes` nulo = mês atual. */
  ler: (empresa: string | null = null, mes: string | null = null) =>
    ler<Painel>('painel_empresa', { p_empresa: empresa, p_mes: mes }),
}
