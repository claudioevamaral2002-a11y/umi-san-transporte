import { describe, expect, it } from 'vitest'
import {
  bpParaTexto,
  centavosParaTexto,
  deEntradaDataHora,
  formatarDataHora,
  formatarDataLonga,
  formatarPercentual,
  inicioDoDia,
  inteiroPositivo,
  paraEntradaDataHora,
  percentualParaBp,
  reaisParaCentavos,
  validarPeriodo,
} from './valores.ts'

describe('reaisParaCentavos', () => {
  it('converte por texto, sem ponto flutuante', () => {
    expect(reaisParaCentavos('1.234,56')).toBe(123456)
    expect(reaisParaCentavos('0,5')).toBe(50)
    expect(reaisParaCentavos('10')).toBe(1000)
    expect(reaisParaCentavos('1234,5')).toBe(123450)
    expect(reaisParaCentavos('0,01')).toBe(1)
    expect(reaisParaCentavos('0')).toBe(0)
    expect(reaisParaCentavos('R$ 12,30')).toBe(1230)
    expect(reaisParaCentavos(' 1.000.000,00 ')).toBe(100000000)
    expect(reaisParaCentavos('12.50')).toBe(1250)
    expect(reaisParaCentavos('1.234')).toBe(123400)
    expect(reaisParaCentavos('007,10')).toBe(710)
    // 0,1 + 0,2 em ponto flutuante daria 0,30000000000000004
    expect(reaisParaCentavos('0,3')).toBe(30)
    expect(reaisParaCentavos('1.005,07')).toBe(100507)
  })

  it('texto inválido → null', () => {
    for (const t of ['', ' ', 'abc', '-1', '1,234', '1,2,3', '12.34.5', '1.23,00', ',5', '1e3', '12,', 'R$', '1 234,00x'])
      expect(reaisParaCentavos(t), t).toBeNull()
    expect(reaisParaCentavos('99999999999999')).toBeNull() // 14 dígitos
    expect(reaisParaCentavos('9999999999999,99')).toBe(999999999999999)
  })
})

describe('centavosParaTexto', () => {
  it('formata para edição', () => {
    expect(centavosParaTexto(123456)).toBe('1.234,56')
    expect(centavosParaTexto(50)).toBe('0,50')
    expect(centavosParaTexto(0)).toBe('0,00')
    expect(centavosParaTexto(100000000)).toBe('1.000.000,00')
    expect(reaisParaCentavos(centavosParaTexto(987654321))).toBe(987654321)
  })
  it('recusa não inteiro ou negativo', () => {
    expect(() => centavosParaTexto(1.5)).toThrow(TypeError)
    expect(() => centavosParaTexto(-1)).toThrow(TypeError)
  })
})

describe('percentuais em pontos-base', () => {
  it('percentualParaBp', () => {
    expect(percentualParaBp('12,5')).toBe(1250)
    expect(percentualParaBp('50')).toBe(5000)
    expect(percentualParaBp('100')).toBe(10000)
    expect(percentualParaBp('0,01')).toBe(1)
    expect(percentualParaBp('12.5')).toBe(1250)
    expect(percentualParaBp('33,33%')).toBe(3333)
    expect(percentualParaBp('0')).toBe(0)
    for (const t of ['', '100,01', '101', '-5', '1,234', 'abc', '1.000']) expect(percentualParaBp(t), t).toBeNull()
  })
  it('bpParaTexto e formatarPercentual', () => {
    expect(bpParaTexto(1250)).toBe('12,5')
    expect(bpParaTexto(5000)).toBe('50')
    expect(bpParaTexto(1)).toBe('0,01')
    expect(bpParaTexto(0)).toBe('0')
    expect(formatarPercentual(10000)).toBe('100%')
    expect(formatarPercentual(3333)).toBe('33,33%')
    expect(() => bpParaTexto(1.5)).toThrow(TypeError)
  })
})

describe('inteiroPositivo', () => {
  it('aceita só inteiros > 0 até o máximo', () => {
    expect(inteiroPositivo('12')).toBe(12)
    expect(inteiroPositivo(' 30 ')).toBe(30)
    for (const t of ['', '0', '-1', '1,5', '1.5', 'x']) expect(inteiroPositivo(t), t).toBeNull()
    expect(inteiroPositivo('366', 365)).toBeNull()
  })
})

describe('datas em America/Sao_Paulo', () => {
  it('ida e volta do datetime-local', () => {
    const d = deEntradaDataHora('2026-10-08T14:30')
    expect(d?.toISOString()).toBe('2026-10-08T17:30:00.000Z')
    expect(paraEntradaDataHora(new Date('2026-10-08T02:05:00Z'))).toBe('2026-10-07T23:05')
    expect(deEntradaDataHora('2026-13-01T00:00')).toBeNull()
    expect(deEntradaDataHora('2026-02-30T10:00')).toBeNull()
    expect(deEntradaDataHora('ontem')).toBeNull()
  })
  it('início e fim do dia', () => {
    expect(inicioDoDia('2026-10-08')?.toISOString()).toBe('2026-10-08T03:00:00.000Z')
    expect(inicioDoDia('2026-10-08', true)?.toISOString()).toBe('2026-10-09T02:59:59.999Z')
    expect(inicioDoDia('08/10/2026')).toBeNull()
  })
  it('formatos pt-BR', () => {
    expect(formatarDataHora('2026-10-08T17:30:00Z')).toBe('08/10/2026 14:30')
    expect(formatarDataLonga(new Date('2026-10-08T15:00:00Z'))).toBe('Quinta-feira, 8 de outubro')
  })
})

describe('validarPeriodo (v2.2)', () => {
  const c = (valor: string, invalido = false) => ({ valor, invalido })
  it('vazio é sem limite', () => {
    expect(validarPeriodo(c(''), c(''))).toBeNull()
    expect(validarPeriodo(c('2026-10-01'), c(''))).toBeNull()
  })
  it('campo incompleto (o navegador acusa) ou data que não existe → Data inválida', () => {
    expect(validarPeriodo(c('', true), c('2026-10-10'))).toBe('Data inválida')
    expect(validarPeriodo(c('2026-10-01'), c('2026-02-31'))).toBe('Data inválida')
    expect(validarPeriodo(c('2026-1-01'), c(''))).toBe('Data inválida')
  })
  it('De depois de Até → A data inicial é depois da final', () => {
    expect(validarPeriodo(c('2026-10-20'), c('2026-10-10'))).toBe('A data inicial é depois da final')
  })
  it('período válido (inclusive o mesmo dia)', () => {
    expect(validarPeriodo(c('2026-10-10'), c('2026-10-10'))).toBeNull()
    expect(validarPeriodo(c('2028-02-29'), c('2028-03-01'))).toBeNull()
  })
})
