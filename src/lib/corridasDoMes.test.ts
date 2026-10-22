import { describe, expect, it } from 'vitest'
import { resumirPorMes } from './corridasDoMes.ts'
import type { ItemPedido } from './pedidos.ts'

const item = (inicio: string, total: number | null, status: ItemPedido['status'] = 'CONCLUIDA') =>
  ({ id: inicio, status, inicio, total_cent: total }) as ItemPedido

describe('resumirPorMes', () => {
  it('conta e soma as concluídas por mês (horário de Brasília), do mais novo para o mais antigo', () => {
    const r = resumirPorMes([
      item('2026-10-15T12:00:00Z', 18000),
      item('2026-10-01T02:00:00Z', 5000), // 30/09 23h em Brasília
      item('2026-10-02T12:00:00Z', 22050),
      item('2026-09-10T12:00:00Z', 10000),
      item('2026-10-03T12:00:00Z', 99999, 'CANCELADA'),
      item('2026-08-03T12:00:00Z', null),
    ])
    expect(r).toEqual([
      { mes: '2026-10', rotulo: 'outubro de 2026', quantidade: 2, total_cent: 40050 },
      { mes: '2026-09', rotulo: 'setembro de 2026', quantidade: 2, total_cent: 15000 },
      { mes: '2026-08', rotulo: 'agosto de 2026', quantidade: 1, total_cent: 0 },
    ])
  })
  it('sem corridas: lista vazia', () => {
    expect(resumirPorMes([])).toEqual([])
  })
})
