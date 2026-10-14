import { describe, expect, it } from 'vitest'
import {
  formDaEntrada,
  formInicial,
  kmParaTexto,
  limitar,
  meiasParaTexto,
  montarEntrada,
  textoParaKmDecimos,
  type FormOrcamento,
} from './orcar.ts'

describe('km e espera sem ponto flutuante acumulado', () => {
  it('km em décimos', () => {
    expect(kmParaTexto(125)).toBe('12,5')
    expect(kmParaTexto(120)).toBe('12')
    expect(kmParaTexto(1)).toBe('0,1')
    expect(textoParaKmDecimos('12,5')).toBe(125)
    expect(textoParaKmDecimos('12.5')).toBe(125)
    expect(textoParaKmDecimos('')).toBe(0)
    expect(textoParaKmDecimos('12,55')).toBeNull()
    expect(textoParaKmDecimos('-3')).toBeNull()
    expect(textoParaKmDecimos('100000,1')).toBeNull()
  })

  it('espera em meias horas e limites dos passos', () => {
    expect(meiasParaTexto(3)).toBe('1,5')
    expect(meiasParaTexto(4)).toBe('2')
    expect(limitar(-1, 0, 10)).toBe(0)
    expect(limitar(11, 0, 10)).toBe(10)
  })
})

describe('montarEntrada', () => {
  const proprio: FormOrcamento = {
    ...formInicial('VEICULO_PROPRIO', 'SIM'),
    kmDecimos: 1253,
    esperaMeias: 3,
    hospedagemDiarias: 1,
    pedagio: '35,80',
    outros: [{ descricao: ' Balsa extra ', valor: '20' }],
  }

  it('veículo próprio: só quantidades da modalidade (nenhum preço)', () => {
    expect(montarEntrada(proprio)).toEqual({
      ok: true,
      entrada: {
        modalidade: 'VEICULO_PROPRIO',
        km: 125.3,
        usa_reboque: true,
        espera_horas: 1.5,
        pedagio_cent: 3580,
        hospedagem_diarias: 1,
        outros: [{ descricao: 'Balsa extra', valor_cent: 2000 }],
      },
    })
  })

  it('veículo do cliente: diárias, sem km/reboque/espera (o servidor recusaria como incompatíveis)', () => {
    const r = montarEntrada({ ...proprio, modalidade: 'VEICULO_CLIENTE', diarias: 2, outros: [] })
    expect(r).toEqual({
      ok: true,
      entrada: { modalidade: 'VEICULO_CLIENTE', diarias: 2, pedagio_cent: 3580, hospedagem_diarias: 1 },
    })
  })

  it('km vira número JSON com no máximo 1 casa', () => {
    for (const d of [1, 3, 7, 29, 1001, 999999]) {
      const r = montarEntrada({ ...proprio, kmDecimos: d })
      expect(r.ok && String(r.entrada.km)).toMatch(/^\d+(\.\d)?$/)
    }
  })

  it('pedágio inválido e "Outros" incompleto não saem', () => {
    expect(montarEntrada({ ...proprio, pedagio: '12,345' })).toMatchObject({ ok: false, erros: { pedagio: expect.any(String) } })
    expect(montarEntrada({ ...proprio, outros: [{ descricao: 'ab', valor: '10' }] })).toMatchObject({ ok: false })
    expect(montarEntrada({ ...proprio, outros: [{ descricao: 'Balsa', valor: '0' }] })).toMatchObject({ ok: false })
    expect(montarEntrada({ ...proprio, pedagio: '' })).toMatchObject({ ok: true, entrada: { pedagio_cent: 0 } })
  })

  it('form inicial segue a modalidade e o reboque do pedido', () => {
    expect(formInicial('VEICULO_PROPRIO', 'NAO_SEI').usaReboque).toBe(false)
    expect(formInicial('VEICULO_CLIENTE', 'NAO').diarias).toBe(1)
  })
})

describe('formDaEntrada com km estimado pela rota (fase 3A)', () => {
  it('sem orçamento anterior, usa os km estimados pela rota; com revisão, vale o anterior', () => {
    expect(formDaEntrada(null, 'VEICULO_PROPRIO', 'SIM', 38.2).kmDecimos).toBe(382)
    expect(formDaEntrada(null, 'VEICULO_PROPRIO', 'SIM', null).kmDecimos).toBe(0)
    expect(formDaEntrada(null, 'VEICULO_PROPRIO', 'SIM').kmDecimos).toBe(0)
    expect(formDaEntrada({ km: 40 }, 'VEICULO_PROPRIO', 'SIM', 38.2).kmDecimos).toBe(400)
  })

  it('km estimado estranho ou veículo do cliente: nada preenchido', () => {
    expect(formDaEntrada(null, 'VEICULO_PROPRIO', 'NAO', -3).kmDecimos).toBe(0)
    expect(formDaEntrada(null, 'VEICULO_PROPRIO', 'NAO', Number.NaN).kmDecimos).toBe(0)
    expect(formDaEntrada(null, 'VEICULO_CLIENTE', 'NAO', 38.2).kmDecimos).toBe(0)
  })
})

describe('formDaEntrada (revisão: pré-preenche com o orçamento anterior)', () => {
  it('volta exatamente à entrada anterior (ida e volta pelo montarEntrada)', () => {
    const anterior = {
      modalidade: 'VEICULO_PROPRIO',
      km: 125.3,
      usa_reboque: true,
      espera_horas: 1.5,
      pedagio_cent: 3580,
      hospedagem_diarias: 1,
      outros: [{ descricao: 'Balsa extra', valor_cent: 2000 }],
    }
    const f = formDaEntrada(anterior, 'VEICULO_PROPRIO', 'NAO')
    expect(f).toMatchObject({ kmDecimos: 1253, usaReboque: true, esperaMeias: 3, pedagio: '35,80', hospedagemDiarias: 1 })
    expect(f.outros).toEqual([{ descricao: 'Balsa extra', valor: '20,00' }])
    expect(montarEntrada(f)).toEqual({ ok: true, entrada: anterior })
  })

  it('a modalidade escolhida antes vence a do pedido', () => {
    const f = formDaEntrada({ modalidade: 'VEICULO_CLIENTE', diarias: 3, pedagio_cent: 0, hospedagem_diarias: 0 }, 'VEICULO_PROPRIO', 'NAO')
    expect(f).toMatchObject({ modalidade: 'VEICULO_CLIENTE', diarias: 3, pedagio: '' })
    expect(montarEntrada(f)).toEqual({
      ok: true,
      entrada: { modalidade: 'VEICULO_CLIENTE', diarias: 3, pedagio_cent: 0, hospedagem_diarias: 0 },
    })
  })

  it('entrada antiga sem modalidade (só km) usa a do pedido', () => {
    expect(formDaEntrada({ km: 80 }, 'VEICULO_PROPRIO', 'SIM')).toMatchObject({
      modalidade: 'VEICULO_PROPRIO',
      kmDecimos: 800,
      usaReboque: true,
    })
  })

  it('valores estranhos caem no padrão, sem quebrar a tela', () => {
    const padrao = formInicial('VEICULO_PROPRIO', 'NAO')
    expect(formDaEntrada(null, 'VEICULO_PROPRIO', 'NAO')).toEqual(padrao)
    expect(formDaEntrada([1, 2], 'VEICULO_PROPRIO', 'NAO')).toEqual(padrao)
    const f = formDaEntrada(
      {
        km: -5,
        espera_horas: '2',
        pedagio_cent: 1e12,
        hospedagem_diarias: 999,
        outros: [{ descricao: 'Ok item', valor_cent: 0 }, 'x', { descricao: '<b>x</b>', valor_cent: 150 }, 1, 2, 3, 4],
      },
      'VEICULO_PROPRIO',
      'NAO',
    )
    expect(f).toMatchObject({ kmDecimos: 0, esperaMeias: 0, pedagio: '', hospedagemDiarias: 0 })
    expect(f.outros).toEqual([{ descricao: '<b>x</b>', valor: '1,50' }])
  })
})
