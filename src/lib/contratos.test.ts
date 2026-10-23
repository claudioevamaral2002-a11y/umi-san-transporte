import { describe, expect, it } from 'vitest'
import {
  CAMPOS,
  descreverFaixas,
  faixaAplicada,
  diferencas,
  FAIXAS_PADRAO,
  formularioDe,
  GRUPOS,
  podeEditarContratos,
  prazoPorExtenso,
  validarFormulario,
  FORMAS_COBRANCA,
  ROTULO_FORMA_COBRANCA,
  type ValoresContrato,
} from './contratos.ts'

const normal = (s: string | null) => s?.replace(/\u00a0/g, ' ') ?? null

const BASE: ValoresContrato = {
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
}

describe('podeEditarContratos', () => {
  it('só o ADM', () => {
    expect(podeEditarContratos('ADM')).toBe(true)
    expect(podeEditarContratos('GESTOR_FROTA')).toBe(false)
    expect(podeEditarContratos('MOTORISTA')).toBe(false)
    expect(podeEditarContratos('CLIENTE')).toBe(false)
    expect(podeEditarContratos(null)).toBe(false)
  })
})

describe('rótulos', () => {
  it('modalidades sem nome de empresa; contrato com os 13 campos (sem retenção de fotos)', () => {
    expect(GRUPOS.map((g) => g.titulo)).toEqual([
      'Modalidade veículo próprio',
      'Modalidade veículo do cliente',
      'Regras de cancelamento e prazos',
      'Crédito da empresa',
    ])
    expect(CAMPOS).toHaveLength(12)
    expect(CAMPOS.map((c) => c.campo)).not.toContain('retencao_fotos_dias')
  })

  it('prazos em linguagem simples', () => {
    expect(prazoPorExtenso(1)).toBe('1 hora')
    expect(prazoPorExtenso(12)).toBe('12 horas')
    expect(prazoPorExtenso(24)).toBe('1 dia')
    expect(prazoPorExtenso(72)).toBe('3 dias')
    expect(prazoPorExtenso(36)).toBe('36 horas')
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
  it('faixa aplicada num cancelamento (frase da multa)', () => {
    expect(faixaAplicada(FAIXAS_PADRAO, { antecedencia_min_horas: 6, multa_bp: 5000 })).toEqual({
      percentual: '50%',
      quando: 'de 6 h a menos de 24 h antes',
    })
    expect(faixaAplicada(FAIXAS_PADRAO, { antecedencia_min_horas: 24, multa_bp: 0 }).quando).toBe('24 h ou mais antes')
    expect(faixaAplicada(FAIXAS_PADRAO, { antecedencia_min_horas: 0, multa_bp: 10000 }).quando).toBe('menos de 6 h antes')
    expect(faixaAplicada(null, { antecedencia_min_horas: 6, multa_bp: 5000 })).toEqual({
      percentual: '50%',
      quando: '6 h ou mais antes',
    })
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

describe('forma de cobrança (v2.1)', () => {
  it('rótulos da interface', () => {
    expect(ROTULO_FORMA_COBRANCA).toEqual({ CREDITO: 'Crédito (pré-pago)', FATURADO: 'Faturado (NF)' })
    expect(FORMAS_COBRANCA).toEqual(['CREDITO', 'FATURADO'])
  })
  it('pré-preenche a forma da partida, mas só a manda quando o Master a muda (sem mexer, o banco herda pela data)', () => {
    const f = formularioDe({ ...BASE, forma_cobranca: 'FATURADO' })
    expect(f.forma_cobranca).toBe('FATURADO')
    // Sem mexer no seletor: a chave não vai (uma troca já agendada não é desfeita).
    expect(validarFormulario(f)).toEqual({
      ok: true,
      valores: { ...BASE, limite_saldo_negativo_cent: 0, alerta_saldo_baixo_cent: 0 },
    })
    const c = formularioDe({ ...BASE, forma_cobranca: 'CREDITO' })
    let r = validarFormulario(c)
    expect(r.ok && 'forma_cobranca' in r.valores).toBe(false)
    // Mudou: vai.
    c.forma_cobranca = 'FATURADO'
    expect(validarFormulario(c)).toMatchObject({ ok: true, valores: { forma_cobranca: 'FATURADO' } })
    f.forma_cobranca = 'CREDITO'
    expect(validarFormulario(f)).toMatchObject({ ok: true, valores: { forma_cobranca: 'CREDITO' } })
    // Mudou e voltou: não vai.
    c.forma_cobranca = 'CREDITO'
    r = validarFormulario(c)
    expect(r.ok && 'forma_cobranca' in r.valores).toBe(false)
    // Sem a forma na versão (banco anterior): só vai se o Master escolher.
    const sem = formularioDe(BASE)
    r = validarFormulario(sem)
    expect(r.ok && 'forma_cobranca' in r.valores).toBe(false)
    sem.forma_cobranca = 'CREDITO'
    expect(validarFormulario(sem)).toMatchObject({ ok: true, valores: { forma_cobranca: 'CREDITO' } })
  })
  it('no Faturado, limite e alerta de saldo em branco (escondidos) valem 0', () => {
    const f = formularioDe({ ...BASE, forma_cobranca: 'FATURADO' })
    f.campos.limite_saldo_negativo_cent = ''
    f.campos.alerta_saldo_baixo_cent = ''
    expect(validarFormulario(f)).toMatchObject({ ok: true, valores: { limite_saldo_negativo_cent: 0, alerta_saldo_baixo_cent: 0 } })
    f.forma_cobranca = 'CREDITO'
    expect(validarFormulario(f).ok).toBe(false)
  })
  it('no Faturado, limite e alerta valem 0 seja qual for o texto (inclusive inválido)', () => {
    const f = formularioDe({ ...BASE, forma_cobranca: 'FATURADO' })
    f.campos.limite_saldo_negativo_cent = 'abc'
    f.campos.alerta_saldo_baixo_cent = '999,99'
    expect(validarFormulario(f)).toMatchObject({ ok: true, valores: { limite_saldo_negativo_cent: 0, alerta_saldo_baixo_cent: 0 } })
  })
  it('a diferença mostra a forma quando ela vai na versão nova', () => {
    const d = diferencas({ ...BASE, forma_cobranca: 'CREDITO' }, { ...BASE, forma_cobranca: 'FATURADO' })
    expect(d.find((x) => x.campo === 'forma_cobranca')).toMatchObject({
      rotulo: 'Forma de cobrança',
      antes: 'Crédito (pré-pago)',
      depois: 'Faturado (NF)',
      mudou: true,
    })
    expect(diferencas(BASE, BASE).some((x) => x.campo === 'forma_cobranca')).toBe(false)
  })
})
