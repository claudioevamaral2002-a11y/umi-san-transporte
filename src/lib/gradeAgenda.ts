import type { Bloco, ConcluidaAgenda } from './pedidos.ts'
import { diaDe, intervaloDoDia, type Janela } from './tempo.ts'

/** Grade de horas da Agenda (visões Dia e 3 dias): posição e largura de cada bloco, e a linha do "agora". */
/** v2.2: `concluida` = corrida em andamento ou concluída (cartão cinza). */
export type TipoItem = 'meu' | 'aguardando' | 'ocupado' | 'livre' | 'concluida'

export interface ItemGrade {
  chave: string
  tipo: TipoItem
  topo: number
  altura: number
  coluna: number
  colunas: number
  bloco?: Bloco
  janela?: Janela
  concluida?: ConcluidaAgenda
}

export interface EntradaGrade {
  chave: string
  tipo: TipoItem
  inicio: string
  fim: string
  bloco?: Bloco
  janela?: Janela
  concluida?: ConcluidaAgenda
}

/** Horas (fracionárias) desde a meia-noite de `dia` em São Paulo. */
function horasNoDia(instante: string | Date, dia: string): number {
  return (new Date(instante).getTime() - intervaloDoDia(dia).de.getTime()) / 3_600_000
}

/** Sem atividade = horário de outra empresa (ocupado); orçamento esperando o cliente = aguardando; senão, meu. */
export function tipoDoBloco(b: Bloco, cliente: boolean): Exclude<TipoItem, 'livre' | 'concluida'> {
  if (b.atividade_id === undefined) return 'ocupado'
  return cliente && b.status === 'ORCADA' ? 'aguardando' : 'meu'
}

/**
 * v2.2: as corridas em andamento e concluídas como itens da grade (do início até início + duração). Uma que ainda tenha
 * bloco ativo na resposta (mesma atividade) fica só como bloco, para não aparecer duas vezes.
 */
export function entradasConcluidas(concluidas: readonly ConcluidaAgenda[], blocos: readonly Bloco[]): EntradaGrade[] {
  const comBloco = new Set(blocos.map((b) => b.atividade_id).filter((id) => id !== undefined))
  return concluidas
    .filter((c) => !comBloco.has(c.id))
    .map((c) => ({
      chave: `c-${c.id}`,
      tipo: 'concluida' as const,
      inicio: c.inicio,
      fim: new Date(new Date(c.inicio).getTime() + Math.max(c.duracao_min, 30) * 60_000).toISOString(),
      concluida: c,
    }))
}

/** Faixa de horas mostrada: 06–20 por padrão, alargada para caber todos os itens (limitada a 0–24). */
export function faixaDeHoras(itens: Array<{ inicio: string; fim: string }>, dia: string): { horaIni: number; horaFim: number } {
  let horaIni = 6
  let horaFim = 20
  for (const it of itens) {
    horaIni = Math.min(horaIni, Math.floor(Math.max(0, horasNoDia(it.inicio, dia))))
    horaFim = Math.max(horaFim, Math.ceil(Math.min(24, horasNoDia(it.fim, dia))))
  }
  return { horaIni, horaFim }
}

/**
 * Topo e altura (px) de cada item, cortados nos limites da grade; itens que se sobrepõem dividem a largura
 * (`coluna` de `colunas`), como numa agenda de calendário.
 */
export function posicionar(itens: EntradaGrade[], dia: string, horaIni: number, horaFim: number, pxPorHora: number): ItemGrade[] {
  const cortados = itens
    .map((it) => ({ it, ini: Math.max(horaIni, horasNoDia(it.inicio, dia)), fim: Math.min(horaFim, horasNoDia(it.fim, dia)) }))
    .filter((x) => x.fim > x.ini)
    .sort((a, b) => a.ini - b.ini || b.fim - a.fim)

  const saida: ItemGrade[] = []
  let grupo: Array<{ x: (typeof cortados)[number]; coluna: number }> = []
  let fimGrupo = -Infinity
  const fechar = () => {
    const colunas = Math.max(...grupo.map((g) => g.coluna + 1))
    for (const { x, coluna } of grupo) {
      const { chave, tipo, bloco, janela, concluida } = x.it
      saida.push({ chave, tipo, bloco, janela, ...(concluida ? { concluida } : {}), topo: (x.ini - horaIni) * pxPorHora, altura: (x.fim - x.ini) * pxPorHora, coluna, colunas })
    }
    grupo = []
  }
  for (const x of cortados) {
    if (grupo.length && x.ini >= fimGrupo) fechar()
    const ocupadas = new Set(grupo.filter((g) => g.x.fim > x.ini).map((g) => g.coluna))
    let coluna = 0
    while (ocupadas.has(coluna)) coluna++
    grupo.push({ x, coluna })
    fimGrupo = grupo.length === 1 ? x.fim : Math.max(fimGrupo, x.fim)
  }
  if (grupo.length) fechar()
  return saida
}

/** Posição (px) da linha do "agora" na grade de `dia`; `null` se não for hoje (em São Paulo) ou se cair fora da faixa. */
export function topoDoAgora(agora: Date, dia: string, horaIni: number, horaFim: number, pxPorHora: number): number | null {
  if (diaDe(agora) !== dia) return null
  const h = horasNoDia(agora, dia)
  return h < horaIni || h > horaFim ? null : (h - horaIni) * pxPorHora
}
