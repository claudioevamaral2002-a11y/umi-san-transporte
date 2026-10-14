import { describe, expect, it } from 'vitest'
import {
  diaDe,
  diaEMes,
  faixaHorario,
  fimDe,
  formatarContagem,
  formatarDuracao,
  formatarQuando,
  gradeDoMes,
  horaDe,
  intervaloDoDia,
  janelasLivres,
  mesDe,
  nomeDoDia,
  nomeDoMes,
  numeroPedido,
  somarDias,
  somarMeses,
} from './tempo.ts'

describe('dia e hora em São Paulo', () => {
  it('converte o instante para o dia e a hora locais (UTC-3), inclusive perto da meia-noite', () => {
    expect(diaDe('2026-10-10T02:30:00Z')).toBe('2026-10-09')
    expect(diaDe('2026-10-10T03:00:00Z')).toBe('2026-10-10')
    expect(horaDe('2026-10-09T11:00:00Z')).toBe('08:00')
    expect(horaDe('2026-10-09T23:30:00+00:00')).toBe('20:30')
  })

  it('intervalo do dia vai da meia-noite local até a seguinte', () => {
    const { de, ate } = intervaloDoDia('2026-10-09')
    expect(de.toISOString()).toBe('2026-10-09T03:00:00.000Z')
    expect(ate.toISOString()).toBe('2026-10-10T03:00:00.000Z')
    expect(intervaloDoDia('2026-12-31').ate.toISOString()).toBe('2027-01-01T03:00:00.000Z')
  })
})

describe('calendário do mês', () => {
  it('mês, soma de meses e de dias (com virada de ano)', () => {
    expect(mesDe('2026-10-09')).toBe('2026-10-01')
    expect(somarMeses('2026-12-01', 1)).toBe('2027-01-01')
    expect(somarMeses('2026-01-01', -1)).toBe('2025-12-01')
    expect(somarDias('2026-02-28', 1)).toBe('2026-03-01')
    expect(somarDias('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('grade de domingo a sábado com vazios antes do dia 1 e depois do último', () => {
    // Outubro de 2026 começa numa quinta-feira (4 vazios), tem 31 dias e termina num sábado.
    const grade = gradeDoMes('2026-10-01')
    expect(grade.length % 7).toBe(0)
    expect(grade.slice(0, 5)).toEqual([null, null, null, null, '2026-10-01'])
    expect(grade.filter(Boolean)).toHaveLength(31)
    expect(grade).toHaveLength(35)
    expect(grade.at(-1)).toBe('2026-10-31')
    expect(gradeDoMes('2026-11-01').at(-1)).toBeNull()
    // Fevereiro de 2026 começa num domingo e ocupa exatamente 4 semanas.
    expect(gradeDoMes('2026-02-01')).toHaveLength(28)
  })

  it('nomes por extenso', () => {
    expect(nomeDoMes('2026-10-01')).toBe('Outubro de 2026')
    expect(nomeDoDia('2026-10-09')).toBe('Sexta-feira, 9 de outubro')
    expect(diaEMes('2026-10-09')).toBe('9 de outubro')
  })
})

describe('duração e contagem regressiva', () => {
  it('formata a duração em horas e minutos', () => {
    expect(formatarDuracao(30)).toBe('30 min')
    expect(formatarDuracao(120)).toBe('2 h')
    expect(formatarDuracao(150)).toBe('2 h 30 min')
    expect(formatarDuracao(1440)).toBe('24 h')
  })

  it('contagem: dias, horas, minutos; vencido = null', () => {
    const agora = new Date('2026-10-09T12:00:00Z')
    const em = (ms: number) => new Date(agora.getTime() + ms)
    expect(formatarContagem(em(-1), agora)).toBeNull()
    expect(formatarContagem(agora, agora)).toBeNull()
    expect(formatarContagem(em(30_000), agora)).toBe('menos de 1 min')
    expect(formatarContagem(em(45 * 60_000 + 59_000), agora)).toBe('45 min')
    expect(formatarContagem(em(3 * 3600_000), agora)).toBe('3 h')
    expect(formatarContagem(em(3 * 3600_000 + 5 * 60_000), agora)).toBe('3 h 5 min')
    expect(formatarContagem(em(24 * 3600_000), agora)).toBe('1 dia')
    expect(formatarContagem(em(52 * 3600_000), agora)).toBe('2 dias 4 h')
    expect(formatarContagem('2026-10-09T12:10:00Z', agora)).toBe('10 min')
  })

  it('quando, faixa de horário, fim e número do pedido', () => {
    expect(formatarQuando('2026-10-09T17:30:00Z')).toMatch(/^sex\.?, 9 de out\.? · 14:30$/)
    expect(faixaHorario('2026-10-09T11:00:00Z', '2026-10-09T13:00:00Z')).toBe('08:00–10:00')
    expect(fimDe('2026-10-09T11:00:00Z', 90).toISOString()).toBe('2026-10-09T12:30:00.000Z')
    expect(numeroPedido(42)).toBe('#0042')
    expect(numeroPedido(123456)).toBe('#123456')
  })
})

describe('janelasLivres', () => {
  it('junta inícios consecutivos de 30 min numa janela e separa os buracos', () => {
    const inicios = [
      '2026-10-09T08:00:00Z',
      '2026-10-09T08:30:00Z',
      '2026-10-09T09:00:00Z',
      '2026-10-09T13:00:00Z',
      '2026-10-09T13:30:00Z',
    ]
    expect(janelasLivres(inicios)).toEqual([
      { inicio: '2026-10-09T08:00:00.000Z', fim: '2026-10-09T09:30:00.000Z' },
      { inicio: '2026-10-09T13:00:00.000Z', fim: '2026-10-09T14:00:00.000Z' },
    ])
  })

  it('aceita fora de ordem, com fuso e vazio', () => {
    expect(janelasLivres([])).toEqual([])
    expect(janelasLivres(['2026-10-09T08:30:00-03:00', '2026-10-09T08:00:00-03:00'])).toEqual([
      { inicio: '2026-10-09T11:00:00.000Z', fim: '2026-10-09T12:00:00.000Z' },
    ])
  })
})

describe('diaDaSemanaCurto', () => {
  it('três letras, maiúscula, sem ponto', async () => {
    const { diaDaSemanaCurto } = await import('./tempo.ts')
    expect(diaDaSemanaCurto('2026-10-13')).toBe('Ter')
    expect(diaDaSemanaCurto('2026-10-17')).toBe('Sáb')
    expect(diaDaSemanaCurto('2026-10-18')).toBe('Dom')
  })
})
