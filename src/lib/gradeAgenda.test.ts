import { describe, expect, it } from 'vitest'
import type { Bloco } from './pedidos.ts'
import { faixaDeHoras, posicionar, tipoDoBloco, topoDoAgora } from './gradeAgenda.ts'

const sp = (hm: string, dia = '2026-10-13') => new Date(`${dia}T${hm}:00-03:00`).toISOString()

describe('posicionar', () => {
  it('converte horário em topo e altura', () => {
    const [b] = posicionar([{ chave: 'a', tipo: 'meu', inicio: sp('07:30'), fim: sp('09:30') }], '2026-10-13', 7, 15, 56)
    expect(b).toMatchObject({ chave: 'a', topo: 28, altura: 112, coluna: 0, colunas: 1 })
  })
  it('divide a largura entre blocos sobrepostos', () => {
    const r = posicionar(
      [
        { chave: 'a', tipo: 'meu', inicio: sp('08:00'), fim: sp('10:00') },
        { chave: 'b', tipo: 'aguardando', inicio: sp('09:00'), fim: sp('11:00') },
        { chave: 'c', tipo: 'livre', inicio: sp('12:00'), fim: sp('13:00') },
      ],
      '2026-10-13', 7, 15, 56,
    )
    expect(r.find((x) => x.chave === 'a')).toMatchObject({ coluna: 0, colunas: 2 })
    expect(r.find((x) => x.chave === 'b')).toMatchObject({ coluna: 1, colunas: 2 })
    expect(r.find((x) => x.chave === 'c')).toMatchObject({ coluna: 0, colunas: 1 })
  })
  it('reaproveita a coluna livre numa cadeia de sobreposições', () => {
    const r = posicionar(
      [
        { chave: 'a', tipo: 'meu', inicio: sp('08:00'), fim: sp('09:00') },
        { chave: 'b', tipo: 'meu', inicio: sp('08:30'), fim: sp('10:00') },
        { chave: 'c', tipo: 'meu', inicio: sp('09:00'), fim: sp('09:30') },
      ],
      '2026-10-13', 7, 15, 56,
    )
    expect(r.find((x) => x.chave === 'c')).toMatchObject({ coluna: 0, colunas: 2 })
  })
  it('corta blocos que passam dos limites da grade ou da meia-noite', () => {
    const [b] = posicionar([{ chave: 'a', tipo: 'meu', inicio: sp('22:00', '2026-10-12'), fim: sp('08:00') }], '2026-10-13', 7, 15, 56)
    expect(b).toMatchObject({ topo: 0, altura: 56 })
  })
  it('descarta o que fica todo fora da grade', () => {
    expect(posicionar([{ chave: 'a', tipo: 'meu', inicio: sp('05:00'), fim: sp('06:00') }], '2026-10-13', 7, 15, 56)).toEqual([])
  })
})

describe('faixaDeHoras', () => {
  it('padrão 06–20 e alarga para caber', () => {
    expect(faixaDeHoras([], '2026-10-13')).toEqual({ horaIni: 6, horaFim: 20 })
    expect(faixaDeHoras([{ inicio: sp('05:30'), fim: sp('21:10') }], '2026-10-13')).toEqual({ horaIni: 5, horaFim: 22 })
  })
  it('limita a 0–24 com bloco que vem do dia anterior', () => {
    expect(faixaDeHoras([{ inicio: sp('22:00', '2026-10-12'), fim: sp('08:00') }], '2026-10-13')).toEqual({ horaIni: 0, horaFim: 20 })
  })
})

describe('topoDoAgora', () => {
  it('usa o horário de São Paulo e some fora do dia ou da faixa', () => {
    expect(topoDoAgora(new Date(sp('10:20')), '2026-10-13', 7, 15, 56)).toBeCloseTo(186.67, 1)
    expect(topoDoAgora(new Date(sp('10:20')), '2026-10-14', 7, 15, 56)).toBeNull()
    expect(topoDoAgora(new Date(sp('06:00')), '2026-10-13', 7, 15, 56)).toBeNull()
  })
})

describe('tipoDoBloco', () => {
  const base: Bloco = { inicio: sp('08:00'), fim: sp('09:00'), ocupado: true }
  it('sem atividade é ocupado; orçado para o cliente é aguardando; senão meu', () => {
    expect(tipoDoBloco(base, true)).toBe('ocupado')
    expect(tipoDoBloco({ ...base, atividade_id: 'x', status: 'ORCADA' }, true)).toBe('aguardando')
    expect(tipoDoBloco({ ...base, atividade_id: 'x', status: 'ORCADA' }, false)).toBe('meu')
    expect(tipoDoBloco({ ...base, atividade_id: 'x', status: 'AGENDADA' }, true)).toBe('meu')
  })
})
