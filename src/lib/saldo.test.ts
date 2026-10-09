import { describe, expect, it } from 'vitest'
import {
  Intencao,
  fracaoReservada,
  ordenarPorRisco,
  resumoDispositivo,
  saldoAposAprovacao,
  saldoAposLancamento,
  semResposta,
} from './saldoExibicao.ts'

describe('saldo depois da aprovação (só exibição)', () => {
  it('cabe no disponível', () => {
    expect(saldoAposAprovacao({ disponivel_cent: 100000, limite_cent: 50000 }, 71000)).toEqual({
      disponivel_depois_cent: 29000,
      cabe: true,
      falta_cent: 0,
      usa_credito: false,
    })
  })

  it('usa o limite de crédito (disponível negativo até −limite)', () => {
    expect(saldoAposAprovacao({ disponivel_cent: 10000, limite_cent: 50000 }, 60000)).toMatchObject({
      disponivel_depois_cent: -50000,
      cabe: true,
      usa_credito: true,
    })
  })

  it('não cabe: quanto falta (igual ao falta_cent do banco)', () => {
    // banco: falta = total − disponível − limite = 71000 − 10000 − 50000
    expect(saldoAposAprovacao({ disponivel_cent: 10000, limite_cent: 50000 }, 71000)).toMatchObject({
      cabe: false,
      falta_cent: 11000,
    })
    expect(saldoAposAprovacao({ disponivel_cent: -20000, limite_cent: 0 }, 1)).toMatchObject({ falta_cent: 20001 })
  })

  it('lançamento manual: contábil e disponível andam juntos', () => {
    expect(saldoAposLancamento({ disponivel_cent: -1000, saldo_contabil_cent: 70000 }, 50000)).toEqual({
      disponivel_depois_cent: 49000,
      contabil_depois_cent: 120000,
    })
  })

  it('barra: fração reservada (disponível negativo conta como zero)', () => {
    expect(fracaoReservada({ disponivel_cent: 30000, reservado_cent: 10000 })).toBe(0.25)
    expect(fracaoReservada({ disponivel_cent: -5000, reservado_cent: 10000 })).toBe(1)
    expect(fracaoReservada({ disponivel_cent: 0, reservado_cent: 0 })).toBe(0)
  })
})

describe('idempotência por intenção', () => {
  it('mesma intenção = mesma chave (nova tentativa); mudou o conteúdo ou encerrou = chave nova', () => {
    let n = 0
    const i = new Intencao(() => `chave-${++n}`)
    expect(i.chave('recarga|e1|5000|Pix')).toBe('chave-1')
    expect(i.chave('recarga|e1|5000|Pix')).toBe('chave-1')
    expect(i.chave('recarga|e1|6000|Pix')).toBe('chave-2')
    i.encerrar()
    expect(i.chave('recarga|e1|6000|Pix')).toBe('chave-3')
  })

  it('padrão: UUID v4 do navegador', () => {
    expect(new Intencao().chave('x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('só falha sem resposta pede a mesma chave', () => {
    expect(semResposta({ ok: false, codigo: 'ERRO_INESPERADO' })).toBe(true)
    expect(semResposta({ ok: false, codigo: 'SALDO_INSUFICIENTE' })).toBe(false)
    expect(semResposta({ ok: true })).toBe(false)
  })
})

describe('outros', () => {
  it('ordena por risco: abaixo do alerta primeiro, depois menor folga', () => {
    const e = (empresa_nome: string, abaixo_alerta: boolean, disponivel_cent: number, limite_cent = 0) => ({
      empresa_nome,
      abaixo_alerta,
      disponivel_cent,
      limite_cent,
    })
    expect(
      ordenarPorRisco([e('C', false, 500), e('A', true, 900), e('B', true, 100), e('D', false, 100, 1000), e('E', false, 500)]).map(
        (x) => x.empresa_nome,
      ),
    ).toEqual(['B', 'A', 'C', 'E', 'D'])
  })

  it('resumo do aparelho', () => {
    expect(
      resumoDispositivo('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'),
    ).toBe('Android · Chrome · app IVO')
    expect(
      resumoDispositivo('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
    ).toBe('iPhone · Safari · app IVO')
    expect(resumoDispositivo('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe(
      'Windows · Edge · app IVO',
    )
    expect(resumoDispositivo('')).toBe('Outro sistema · Outro navegador · app IVO')
  })
})
