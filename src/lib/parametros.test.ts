import { describe, expect, it } from 'vitest'
import {
  CAMPOS,
  descreverFaixas,
  diferencas,
  FAIXAS_PADRAO,
  formularioDe,
  podeEditarParametros,
  validarFormulario,
  type ValoresParametros,
} from './parametros.ts'

const normal = (s: string | null) => s?.replace(/\u00a0/g, ' ') ?? null

const BASE: ValoresParametros = {
  km_sem_reboque_cent: 350,
  km_com_reboque_cent: 520,
  taxa_fixa_reboque_cent: 15000,
  retorno_trecho_unico_bp: 5000,
  hora_espera_cent: 4000,
  hospedagem_diaria_cent: 18000,
  diaria_motorista_cent: 45000,
  faixas_cancelamento: FAIXAS_PADRAO,
  prazo_orcar_horas: 12,
  validade_orcamento_horas: 24,
  limiar_urgente_horas: 6,
  limite_saldo_negativo_cent: 100000,
  alerta_saldo_baixo_cent: 50000,
  retencao_fotos_dias: 30,
}

describe('podeEditarParametros', () => {
  const ligada = [{ chave: 'MOTORISTA_EDITA_PARAMETROS', ativo: true }]
  const desligada = [{ chave: 'MOTORISTA_EDITA_PARAMETROS', ativo: false }]
  it('ADM sempre; motorista só com a delegação; cliente nunca', () => {
    expect(podeEditarParametros('ADM', [])).toBe(true)
    expect(podeEditarParametros('MOTORISTA', [])).toBe(false)
    expect(podeEditarParametros('MOTORISTA', desligada)).toBe(false)
    expect(podeEditarParametros('MOTORISTA', ligada)).toBe(true)
    expect(podeEditarParametros('MOTORISTA', [{ chave: 'MOTORISTA_LANCA_RECARGA', ativo: true }])).toBe(false)
    expect(podeEditarParametros('CLIENTE', ligada)).toBe(false)
    expect(podeEditarParametros(null, ligada)).toBe(false)
  })
})

describe('descreverFaixas', () => {
  it('padrão em frases', () => {
    expect(descreverFaixas(FAIXAS_PADRAO)).toEqual([
      '24 h ou mais antes: sem multa',
      'De 6 h a menos de 24 h antes: multa de 50%',
      'Menos de 6 h antes: multa de 100%',
    ])
  })
  it('faixa única', () => {
    expect(descreverFaixas([{ antecedencia_min_horas: 0, multa_bp: 1250 }])).toEqual([
      'Qualquer antecedência: multa de 12,5%',
    ])
  })
})

describe('formulário', () => {
  it('preenche a partir da versão e volta aos mesmos valores', () => {
    const f = formularioDe(BASE)
    expect(f.campos.km_sem_reboque_cent).toBe('3,50')
    expect(f.campos.retorno_trecho_unico_bp).toBe('50')
    expect(f.campos.prazo_orcar_horas).toBe('12')
    expect(f.faixas).toEqual([
      { horas: '24', multa: '0' },
      { horas: '6', multa: '50' },
      { horas: '0', multa: '100' },
    ])
    expect(validarFormulario(f)).toEqual({ ok: true, valores: BASE })
  })

  it('sem versão: campos vazios e faixas padrão; vazio não valida', () => {
    const f = formularioDe(null)
    expect(Object.values(f.campos).every((v) => v === '')).toBe(true)
    const r = validarFormulario(f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.erros)).toHaveLength(CAMPOS.length)
  })

  it('aponta cada campo inválido', () => {
    const f = formularioDe(BASE)
    f.campos.km_sem_reboque_cent = '3,505'
    f.campos.retorno_trecho_unico_bp = '120'
    f.campos.prazo_orcar_horas = '0'
    const r = validarFormulario(f)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(Object.keys(r.erros).sort()).toEqual(['km_sem_reboque_cent', 'prazo_orcar_horas', 'retorno_trecho_unico_bp'])
    }
  })

  it('faixas: decrescentes, última em 0 h, multa até 100%', () => {
    const f = formularioDe(BASE)
    f.faixas = [
      { horas: '6', multa: '0' },
      { horas: '24', multa: '50' },
      { horas: '0', multa: '100' },
    ]
    expect(validarFormulario(f)).toMatchObject({ ok: false, erros: { faixas: expect.stringMatching(/diminuir/) } })
    f.faixas = [{ horas: '24', multa: '0' }]
    expect(validarFormulario(f)).toMatchObject({ ok: false, erros: { faixas: expect.stringMatching(/0 h/) } })
    f.faixas = [{ horas: '0', multa: '101' }]
    expect(validarFormulario(f)).toMatchObject({ ok: false, erros: { faixas: expect.stringMatching(/Faixa 1/) } })
    f.faixas = []
    expect(validarFormulario(f)).toMatchObject({ ok: false, erros: { faixas: expect.any(String) } })
  })
})

describe('diferencas', () => {
  it('marca só o que mudou', () => {
    const novo = { ...BASE, km_sem_reboque_cent: 400, faixas_cancelamento: [{ antecedencia_min_horas: 0, multa_bp: 10000 }] }
    const d = diferencas(BASE, novo)
    expect(d).toHaveLength(CAMPOS.length + 1)
    const mudaram = d.filter((x) => x.mudou)
    expect(mudaram.map((x) => x.campo)).toEqual(['km_sem_reboque_cent', 'faixas_cancelamento'])
    expect(normal(mudaram[0]!.antes)).toBe('R$ 3,50')
    expect(normal(mudaram[0]!.depois)).toBe('R$ 4,00')
    expect(mudaram[1]!.depois).toBe('Qualquer antecedência: multa de 100%')
  })

  it('sem versão anterior: tudo é novo', () => {
    const d = diferencas(null, BASE)
    expect(d.every((x) => x.mudou && x.antes === null)).toBe(true)
  })

  it('versões iguais: nada muda', () => {
    expect(diferencas(BASE, { ...BASE, faixas_cancelamento: [...FAIXAS_PADRAO] }).some((x) => x.mudou)).toBe(false)
  })
})
