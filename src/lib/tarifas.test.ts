import { describe, expect, it } from 'vitest'
import { CAMPOS_TARIFA, diferencas, doFormulario, paraFormulario, type Tarifa } from './tarifas.ts'

const ZERO: Tarifa = {
  taxa_fixa_cent: 0,
  km_cent: 0,
  hora_cent: 0,
  hora_espera_cent: 0,
  parada_cent: 0,
  retorno_bp: 0,
  reboque_cent: 0,
  hospedagem_diaria_cent: 0,
}

describe('doFormulario', () => {
  it('reais com vírgula viram centavos e % vira pontos-base; o que não vem é zero', () => {
    expect(doFormulario({ km: '3,50', retorno: '20' })).toEqual({ ...ZERO, km_cent: 350, retorno_bp: 2000 })
  })
  it('todos os oito campos', () => {
    expect(
      doFormulario({
        taxa: '10',
        km: '3,50',
        hora: '45,00',
        espera: '30',
        parada: '5,5',
        retorno: '12,5%',
        reboque: '150,00',
        hospedagem: '1.234,56',
      }),
    ).toEqual({
      taxa_fixa_cent: 1000,
      km_cent: 350,
      hora_cent: 4500,
      hora_espera_cent: 3000,
      parada_cent: 550,
      retorno_bp: 1250,
      reboque_cent: 15000,
      hospedagem_diaria_cent: 123456,
    })
  })
  it('vazio e espaços valem zero (zerado = não cobra)', () => {
    expect(doFormulario({ km: '  ', hora: '' })).toEqual(ZERO)
    expect(doFormulario({})).toEqual(ZERO)
  })
  it('valor negativo ou ilegível: erro por campo', () => {
    const r = doFormulario({ km: '-1', hora: 'abc' })
    expect('erro' in r).toBe(true)
    if ('erro' in r) {
      expect(r.erro).toBeTruthy()
      expect(Object.keys(r.campos).sort()).toEqual(['hora', 'km'])
    }
  })
  it('retorno acima de 100% é erro', () => {
    const r = doFormulario({ retorno: '101' })
    expect('erro' in r).toBe(true)
    if ('erro' in r) expect(Object.keys(r.campos)).toEqual(['retorno'])
  })
})

describe('paraFormulario', () => {
  it('é o inverso de doFormulario', () => {
    const t: Tarifa = {
      taxa_fixa_cent: 1000,
      km_cent: 350,
      hora_cent: 4500,
      hora_espera_cent: 3000,
      parada_cent: 550,
      retorno_bp: 1250,
      reboque_cent: 15000,
      hospedagem_diaria_cent: 123456,
    }
    const f = paraFormulario(t)
    expect(f.km).toBe('3,50')
    expect(f.retorno).toBe('12,5')
    expect(f.hospedagem).toBe('1.234,56')
    expect(doFormulario(f)).toEqual(t)
  })
  it('ignora as chaves extras que a leitura traz (inicial)', () => {
    expect(paraFormulario({ ...ZERO, km_cent: 100, inicial: true } as Tarifa).km).toBe('1,00')
  })
})

describe('diferencas', () => {
  it('lista só o que mudou, com rótulo e valores em reais', () => {
    const antes = { ...ZERO, km_cent: 350, retorno_bp: 2000 }
    const depois = { ...ZERO, km_cent: 380, retorno_bp: 2000, hora_cent: 4500 }
    expect(diferencas(antes, depois)).toEqual(['Por km: R$ 3,50 → R$ 3,80', 'Por hora: R$ 0,00 → R$ 45,00'])
  })
  it('percentual do retorno', () => {
    expect(diferencas({ ...ZERO, retorno_bp: 2000 }, { ...ZERO, retorno_bp: 2500 })).toEqual(['Retorno: 20% → 25%'])
  })
  it('sem mudança: lista vazia', () => {
    expect(diferencas({ ...ZERO, km_cent: 1 }, { ...ZERO, km_cent: 1 })).toEqual([])
  })
  it('categoria nova (sem antes): mostra o que passa a cobrar', () => {
    expect(diferencas(null, { ...ZERO, km_cent: 380, reboque_cent: 15000 })).toEqual([
      'Por km: — → R$ 3,80',
      'Reboque: — → R$ 150,00',
    ])
  })
  it('todos os campos têm rótulo', () => {
    expect(CAMPOS_TARIFA).toHaveLength(8)
  })
})
