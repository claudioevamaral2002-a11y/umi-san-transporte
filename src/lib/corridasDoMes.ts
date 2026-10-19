// Fase 4 (especificação §6.7): "Corridas do mês" do motorista. Quantas corridas concluídas e o total cobrado dos
// clientes (o orçamento aprovado, que é o que sai do saldo na saída), por mês, a partir de `api.meus_pedidos`.
// Não é o repasse ao motorista, que ainda não existe.
import type { ItemPedido } from './pedidos.ts'
import { FUSO } from './valores.ts'

export interface ResumoMes {
  /** "2026-10" */
  mes: string
  /** "outubro de 2026" */
  rotulo: string
  quantidade: number
  total_cent: number
}

const ANO_MES = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit' })
const ROTULO = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, month: 'long', year: 'numeric' })

/** Só as CONCLUIDA, agrupadas pelo mês do início (horário de Brasília), do mês mais novo para o mais antigo. */
export function resumirPorMes(itens: readonly ItemPedido[]): ResumoMes[] {
  const meses = new Map<string, ResumoMes>()
  for (const i of itens) {
    if (i.status !== 'CONCLUIDA') continue
    const data = new Date(i.inicio)
    const mes = ANO_MES.format(data).slice(0, 7)
    const r = meses.get(mes) ?? { mes, rotulo: ROTULO.format(data), quantidade: 0, total_cent: 0 }
    r.quantidade += 1
    r.total_cent += i.total_cent ?? 0
    meses.set(mes, r)
  }
  return [...meses.values()].sort((a, b) => b.mes.localeCompare(a.mes))
}
