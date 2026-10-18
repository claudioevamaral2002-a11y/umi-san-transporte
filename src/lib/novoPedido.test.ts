import { describe, expect, it } from 'vitest'
import {
  CHAVE_RASCUNHO,
  FORM_VAZIO,
  guardarRascunho,
  lerRascunho,
  mascararTelefone,
  montarPedido,
  pesoParaNumero,
  primeiroPassoComErro,
  temDados,
  validarPasso,
  type FormPedido,
} from './novoPedido.ts'

const COMPLETO: FormPedido = {
  ...FORM_VAZIO,
  dia: '2026-10-12',
  inicio: '2026-10-12T11:00:00.000Z',
  duracaoMin: 150,
  origem: '  Porto de Itajaí ',
  destino: 'Base Navegantes',
  levar: true,
  trazer: false,
  contatoNome: 'Rui',
  contatoTelefone: '(47) 99999-1234',
}

describe('mascararTelefone', () => {
  it('formata enquanto digita (fixo e celular), ignorando o que não é dígito', () => {
    expect(mascararTelefone('')).toBe('')
    expect(mascararTelefone('4')).toBe('(4')
    expect(mascararTelefone('47')).toBe('(47')
    expect(mascararTelefone('473')).toBe('(47) 3')
    expect(mascararTelefone('4733331234')).toBe('(47) 3333-1234')
    expect(mascararTelefone('47999991234')).toBe('(47) 99999-1234')
    expect(mascararTelefone('+55 (47) 9 9999-1234 ramal')).toBe('(55) 47999-9912')
    expect(mascararTelefone('479999912345678')).toBe('(47) 99999-1234')
  })

  it('o resultado passa no formato aceito pelo banco', () => {
    expect(mascararTelefone('47999991234')).toMatch(/^[0-9+() .-]{8,25}$/)
  })
})

describe('pesoParaNumero', () => {
  it('aceita vírgula ou ponto com até 2 casas, > 0 e ≤ 100.000', () => {
    expect(pesoParaNumero('120')).toBe(120)
    expect(pesoParaNumero('85,5')).toBe(85.5)
    expect(pesoParaNumero('0.25')).toBe(0.25)
    expect(pesoParaNumero('100000')).toBe(100000)
    expect(pesoParaNumero('100000,01')).toBeNull()
    expect(pesoParaNumero('0')).toBeNull()
    expect(pesoParaNumero('1,234')).toBeNull()
    expect(pesoParaNumero('abc')).toBeNull()
  })
})

describe('validarPasso', () => {
  it('passo 1 exige dia e horário', () => {
    expect(validarPasso(1, FORM_VAZIO).inicio).toBeTruthy()
    expect(validarPasso(1, COMPLETO)).toEqual({})
  })

  it('passo 2: Levar e Trazer são independentes, mas ao menos um', () => {
    expect(validarPasso(2, { ...COMPLETO, levar: false, trazer: false }).trajeto).toBe('Marque Levar, Trazer ou os dois.')
    expect(validarPasso(2, { ...COMPLETO, levar: false, trazer: true })).toEqual({})
    expect(validarPasso(2, { ...COMPLETO, levar: true, trazer: true })).toEqual({})
  })

  it('passo 2: origem/destino de 3 a 200; contato opcional, telefone com DDD', () => {
    const e = validarPasso(2, { ...COMPLETO, origem: 'ab', destino: 'x'.repeat(201), contatoTelefone: '(47) 9999' })
    expect(Object.keys(e).sort()).toEqual(['contatoTelefone', 'destino', 'origem'])
    expect(validarPasso(2, { ...COMPLETO, contatoNome: '', contatoTelefone: '' })).toEqual({})
    expect(validarPasso(2, { ...COMPLETO, contatoNome: 'R' }).contatoNome).toBeTruthy()
  })

  it('passo 3: campos conforme a carga', () => {
    expect(validarPasso(3, { ...COMPLETO, carga: 'PESSOAS', pessoasQtd: 0 }).pessoasQtd).toBeTruthy()
    expect(validarPasso(3, { ...COMPLETO, carga: 'EQUIPAMENTO', pessoasQtd: 0, equipamentoDesc: 'ok' }).equipamentoDesc).toBeTruthy()
    expect(validarPasso(3, { ...COMPLETO, carga: 'EQUIPAMENTO', equipamentoDesc: 'Bomba', pesoKg: '1,234' }).pesoKg).toBeTruthy()
    expect(validarPasso(3, { ...COMPLETO, carga: 'AMBOS', equipamentoDesc: 'Bomba', pesoKg: '12,5', dimensoes: '1 × 1 m' })).toEqual({})
    expect(validarPasso(3, { ...COMPLETO, observacoes: 'x'.repeat(1001) }).observacoes).toBeTruthy()
  })

  it('primeiro passo com erro (para o "Editar" do revisar)', () => {
    expect(primeiroPassoComErro(COMPLETO)).toBeNull()
    expect(primeiroPassoComErro({ ...COMPLETO, trazer: false, levar: false })).toBe(2)
    expect(primeiroPassoComErro({ ...COMPLETO, inicio: null })).toBe(1)
  })
})

describe('montarPedido', () => {
  it('pessoas: sem campos de equipamento; textos aparados; opcionais vazios viram null', () => {
    expect(montarPedido({ ...COMPLETO, contatoNome: '', observacoes: '  ' })).toEqual({
      inicio: '2026-10-12T11:00:00.000Z',
      duracao_min: 150,
      origem: 'Porto de Itajaí',
      destino: 'Base Navegantes',
      levar: true,
      trazer: false,
      carga: 'PESSOAS',
      pessoas_qtd: 1,
      modalidade: 'VEICULO_PROPRIO',
      reboque: 'NAO',
      contato_nome: null,
      contato_telefone: '(47) 99999-1234',
      observacoes: null,
    })
  })

  it('equipamento: sem pessoas; peso como número; ambos leva os dois grupos', () => {
    const eq = montarPedido({ ...COMPLETO, carga: 'EQUIPAMENTO', equipamentoDesc: ' Bomba ', pesoKg: '85,5', dimensoes: '' })
    expect(eq).not.toHaveProperty('pessoas_qtd')
    expect(eq).toMatchObject({ equipamento_desc: 'Bomba', peso_kg: 85.5, dimensoes: null })
    const ambos = montarPedido({ ...COMPLETO, carga: 'AMBOS', pessoasQtd: 3, equipamentoDesc: 'Bomba', pesoKg: '' })
    expect(ambos).toMatchObject({ pessoas_qtd: 3, equipamento_desc: 'Bomba', peso_kg: null })
  })

  it('sem horário não monta', () => {
    expect(() => montarPedido(FORM_VAZIO)).toThrow()
  })
})

describe('montarPedido com endereços (fase 3A, termos do Google)', () => {
  it('ponto do Google vai só pelo place_id; ponto marcado no mapa vai com as coordenadas; km nunca vai', () => {
    const base = { ...COMPLETO }
    expect(montarPedido(base)).not.toHaveProperty('origem_place_id')
    const p = montarPedido({
      ...base,
      origemLocal: { nome: 'Porto', endereco: 'Av. X', lat: -26.9, lng: -48.66, place_id: 'ChIJabc' },
      destinoLocal: { nome: 'Marina, rampa 2', endereco: null, lat: -26.89, lng: -48.65, place_id: null },
      kmEstimado: 38.2,
      minutosEstimados: 45,
    })
    expect(p).toMatchObject({ origem_place_id: 'ChIJabc', destino_lat: -26.89, destino_lng: -48.65 })
    for (const chave of ['origem_lat', 'origem_lng', 'origem_endereco', 'destino_place_id', 'km_estimado', 'minutos_estimados']) {
      expect(p).not.toHaveProperty(chave)
    }
  })

  it('local da empresa do Google (sem coordenadas) vai pelo place_id', () => {
    const p = montarPedido({
      ...COMPLETO,
      destinoLocal: { nome: 'Estaleiro', endereco: null, lat: null, lng: null, place_id: 'ChIJdef' },
    })
    expect(p).toMatchObject({ destino_place_id: 'ChIJdef' })
    expect(p).not.toHaveProperty('destino_lat')
  })
})

describe('rascunho para depois de uma atualização do app', () => {
  const MIN = 60_000
  const AGORA = Date.parse('2026-10-18T15:00:00Z')

  function armazemFalso(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { dados: Map<string, string> } {
    const dados = new Map<string, string>()
    return {
      dados,
      getItem: (k) => dados.get(k) ?? null,
      setItem: (k, v) => void dados.set(k, v),
      removeItem: (k) => void dados.delete(k),
    }
  }

  const bloqueado: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
    removeItem: () => {
      throw new Error('SecurityError')
    },
  }

  it('guarda e devolve o formulário uma vez só', () => {
    const a = armazemFalso()
    guardarRascunho(COMPLETO, a, AGORA)
    expect(JSON.parse(a.dados.get(CHAVE_RASCUNHO)!)).toEqual({ em: AGORA, f: COMPLETO })
    expect(lerRascunho(a, AGORA + 5 * MIN)).toEqual(COMPLETO)
    expect(a.dados.has(CHAVE_RASCUNHO)).toBe(false)
    expect(lerRascunho(a, AGORA + 5 * MIN)).toBeNull()
  })

  it('descarta rascunho com mais de 30 minutos (ou com data no futuro)', () => {
    const a = armazemFalso()
    guardarRascunho(COMPLETO, a, AGORA)
    expect(lerRascunho(a, AGORA + 30 * MIN + 1)).toBeNull()
    expect(a.dados.has(CHAVE_RASCUNHO)).toBe(false)
    guardarRascunho(COMPLETO, a, AGORA)
    expect(lerRascunho(a, AGORA + 30 * MIN)).toEqual(COMPLETO)
    guardarRascunho(COMPLETO, a, AGORA + 10 * MIN)
    expect(lerRascunho(a, AGORA)).toBeNull()
  })

  it('JSON estragado ou com outro formato é descartado', () => {
    const a = armazemFalso()
    for (const ruim of ['{', 'null', '[]', '{"em":"ontem","f":{}}', `{"em":${AGORA}}`, `{"em":${AGORA},"f":"x"}`]) {
      a.dados.set(CHAVE_RASCUNHO, ruim)
      expect(lerRascunho(a, AGORA)).toBeNull()
      expect(a.dados.has(CHAVE_RASCUNHO)).toBe(false)
    }
  })

  it('campos que faltam (rascunho de uma versão anterior) vêm do formulário vazio', () => {
    const a = armazemFalso()
    const semAlguns: Partial<FormPedido> = { ...COMPLETO }
    delete semAlguns.observacoes
    delete semAlguns.reboque
    a.dados.set(CHAVE_RASCUNHO, JSON.stringify({ em: AGORA, f: semAlguns }))
    expect(lerRascunho(a, AGORA)).toEqual({ ...COMPLETO, observacoes: '', reboque: 'NAO' })
  })

  it('armazenamento bloqueado (navegação privada) ou ausente não quebra', () => {
    expect(() => guardarRascunho(COMPLETO, bloqueado, AGORA)).not.toThrow()
    expect(lerRascunho(bloqueado, AGORA)).toBeNull()
    expect(() => guardarRascunho(COMPLETO, null, AGORA)).not.toThrow()
    expect(lerRascunho(null, AGORA)).toBeNull()
  })
})

describe('temDados', () => {
  it('formulário intocado pode fechar sem perguntar', () => {
    expect(temDados(FORM_VAZIO)).toBe(false)
    expect(temDados({ ...FORM_VAZIO, levar: true })).toBe(true)
    expect(temDados({ ...FORM_VAZIO, origem: 'a' })).toBe(true)
  })
})
