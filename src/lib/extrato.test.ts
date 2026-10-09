import { describe, expect, it } from 'vitest'
import {
  efeitoDisponivel,
  formatarComSinal,
  montarCsv,
  natureza,
  nomeArquivo,
  periodoDe,
  valorPlanilha,
} from './extrato.ts'
import type { ItemExtrato } from './saldo.ts'

const item = (extra: Partial<ItemExtrato>): ItemExtrato => ({
  id: 1,
  criado_em: '2026-10-09T13:05:00Z',
  tipo: 'RECARGA',
  valor_cent: 100000,
  efeito_contabil_cent: 100000,
  efeito_reservado_cent: 0,
  numero: null,
  solicitante_nome: null,
  pode_abrir: false,
  atividade_id: null,
  estorna_id: null,
  ...extra,
})

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

describe('valores com sinal', () => {
  it('crédito com +, débito com − (tipográfico) e zero sem sinal', () => {
    expect(nbsp(formatarComSinal(123456))).toBe('+ R$ 1.234,56')
    expect(nbsp(formatarComSinal(-5000))).toBe('− R$ 50,00')
    expect(nbsp(formatarComSinal(0))).toBe('R$ 0,00')
    expect(nbsp(formatarComSinal(-1))).toBe('− R$ 0,01')
  })

  it('planilha: milhar com ponto, vírgula decimal e hífen', () => {
    expect(valorPlanilha(123456789)).toBe('1.234.567,89')
    expect(valorPlanilha(-5)).toBe('-0,05')
    expect(valorPlanilha(0)).toBe('0,00')
    expect(() => valorPlanilha(1.5)).toThrow()
  })

  it('reserva tira do disponível e liberação devolve, sem mexer no contábil', () => {
    const reserva = item({ tipo: 'RESERVA', valor_cent: 71000, efeito_contabil_cent: 0, efeito_reservado_cent: 71000 })
    const liberacao = item({ tipo: 'LIBERACAO_RESERVA', valor_cent: 71000, efeito_contabil_cent: 0, efeito_reservado_cent: -71000 })
    const multa = item({ tipo: 'MULTA', valor_cent: -35500, efeito_contabil_cent: -35500 })
    expect([efeitoDisponivel(reserva), natureza(reserva)]).toEqual([-71000, 'Reservado'])
    expect([efeitoDisponivel(liberacao), natureza(liberacao)]).toEqual([71000, 'Liberado'])
    expect([efeitoDisponivel(multa), natureza(multa)]).toEqual([-35500, 'Débito'])
    expect(natureza(item({}))).toBe('Crédito')
  })
})

describe('períodos (São Paulo)', () => {
  // 09/10/2026 01:30 em São Paulo = 04:30 UTC.
  const agora = new Date('2026-10-09T04:30:00Z')

  it('este mês: do dia 1 até o fim de hoje ([de, ate) com ate = amanhã 00:00)', () => {
    const p = periodoDe('mes', agora)!
    expect(p.de.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    expect(p.ate.toISOString()).toBe('2026-10-10T03:00:00.000Z')
    expect([p.diaDe, p.diaAte]).toEqual(['2026-10-01', '2026-10-09'])
  })

  it('perto da meia-noite UTC continua no dia de São Paulo', () => {
    const p = periodoDe('7d', new Date('2026-10-10T02:59:00Z'))!
    expect([p.diaDe, p.diaAte]).toEqual(['2026-10-03', '2026-10-09'])
  })

  it('30 dias, mês passado (virada de ano) e datas escolhidas', () => {
    expect(periodoDe('30d', agora)).toMatchObject({ diaDe: '2026-09-10', diaAte: '2026-10-09' })
    expect(periodoDe('mes_anterior', new Date('2027-01-15T15:00:00Z'))).toMatchObject({
      diaDe: '2026-12-01',
      diaAte: '2026-12-31',
    })
    const p = periodoDe('personalizado', agora, { de: '2026-09-01', ate: '2026-09-01' })!
    expect(p.ate.getTime() - p.de.getTime()).toBe(24 * 3600_000)
    expect(periodoDe('personalizado', agora, { de: '2026-09-02', ate: '2026-09-01' })).toBeNull()
    expect(periodoDe('personalizado', agora, { de: '', ate: '2026-09-01' })).toBeNull()
    expect(periodoDe('personalizado', agora)).toBeNull()
  })

  it('nome do arquivo com empresa (sem acentos) e período', () => {
    expect(nomeArquivo('Umi San Ação & Cia.', { diaDe: '2026-10-01', diaAte: '2026-10-31' })).toBe(
      'extrato-umi-san-acao-cia-2026-10-01-a-2026-10-31',
    )
    expect(nomeArquivo('***', { diaDe: '2026-10-01', diaAte: '2026-10-01' })).toBe('extrato-empresa-2026-10-01-a-2026-10-01')
  })
})

describe('CSV', () => {
  const itens: ItemExtrato[] = [
    item({
      id: 3,
      tipo: 'MULTA',
      valor_cent: -35500,
      efeito_contabil_cent: -35500,
      numero: 42,
      solicitante_nome: 'Diego; "Rocha"',
      motivo: '=HYPERLINK("x")',
      comprovante: null,
      criado_por_nome: 'Ana',
    }),
    item({ id: 2, tipo: 'RESERVA', valor_cent: 71000, efeito_contabil_cent: 0, efeito_reservado_cent: 71000, numero: 42 }),
  ]

  it('BOM, ponto e vírgula, CRLF, datas e valores pt-BR; texto escapado', () => {
    const csv = montarCsv(itens)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const linhas = csv.slice(1).split('\r\n')
    expect(linhas[0]).toBe(
      'Data;Tipo;Natureza;Valor no disponível (R$);Efeito no saldo contábil (R$);Efeito no reservado (R$);Pedido;Solicitante',
    )
    expect(linhas[1]).toBe('09/10/2026 10:05;Multa de cancelamento;Débito;-355,00;-355,00;0,00;#0042;"Diego; ""Rocha"""')
    expect(linhas[2]).toBe('09/10/2026 10:05;Reserva;Reservado;-710,00;0,00;710,00;#0042;')
    expect(linhas[3]).toBe('')
    expect(csv).not.toContain('HYPERLINK')
  })

  it('ADM: motivo, comprovante e autor, com fórmula neutralizada', () => {
    const linhas = montarCsv(itens, { adm: true }).slice(1).split('\r\n')
    expect(linhas[0]!.endsWith(';Motivo;Comprovante;Lançado por')).toBe(true)
    expect(linhas[1]!.endsWith(`;"'=HYPERLINK(""x"")";;Ana`)).toBe(true)
  })
})
