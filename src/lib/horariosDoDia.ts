import { diaEMes, fimDe, horaDe, nomeDoDia } from './tempo.ts'

/**
 * Grade do passo "Quando": do primeiro ao último horário livre do dia, de `passoMin` em `passoMin`; o que não está
 * entre os livres aparece como ocupado. O banco só devolve os livres, então nada antes do primeiro nem depois do
 * último é inventado (dia sem livres → lista vazia).
 */
export function horariosDoDia(livres: string[], passoMin = 30): Array<{ inicio: string; livre: boolean }> {
  if (livres.length === 0) return []
  const ms = livres.map((l) => new Date(l).getTime()).sort((a, b) => a - b)
  const conjunto = new Set(ms)
  const saida: Array<{ inicio: string; livre: boolean }> = []
  for (let t = ms[0]!; t <= ms[ms.length - 1]!; t += passoMin * 60_000) {
    saida.push({ inicio: new Date(t).toISOString(), livre: conjunto.has(t) })
  }
  return saida
}

/** "Terça, 13 de outubro, das 07:30 às 09:30". */
export function fraseQuando(dia: string, inicio: string, duracaoMin: number): string {
  const semana = nomeDoDia(dia).split(',')[0]!.replace('-feira', '')
  return `${semana}, ${diaEMes(dia)}, das ${horaDe(inicio)} às ${horaDe(fimDe(inicio, duracaoMin))}`
}
