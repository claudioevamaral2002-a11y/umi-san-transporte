import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MENSAGENS, VEICULO_AO_ORCAR, mensagemAoOrcar, mensagemDoCodigo, mensagemDoPedido, mensagemErroAuth } from './erros.ts'

/**
 * Códigos conhecidos, levantados por grep em `supabase/migrations` (interno.negar / 'codigo', '…')
 * e `supabase/functions` (codigo: '…', validarForcaSenha, registrar … 'ERRO_AUTH').
 */
const CODIGOS_CONHECIDOS = [
  // migrations
  'ALVO_ADM',
  'CAMINHO_INVALIDO',
  'CAMPOS_INVALIDOS',
  'CHAVE_INVALIDA',
  'JA_CADASTRADO',
  'EMAIL_EM_USO',
  'JA_EXISTE_ADM',
  'LIMITE_EXCEDIDO',
  'MOTIVO_OBRIGATORIO',
  'NAO_ENCONTRADO',
  'NAO_PERMITIDO',
  'PROPRIO_PAPEL',
  'PROPRIO_USUARIO',
  'REAUTENTICACAO_NECESSARIA',
  'SEM_PERMISSAO',
  'ULTIMO_ADM',
  'VIGENCIA_NO_PASSADO',
  'VERSAO_FUTURA_PENDENTE',
  'EXPIRADO',
  'SEM_CONTRATO',
  'SEM_MOTORISTA',
  'HORARIO_OCUPADO',
  'STATUS_INVALIDO',
  'PRAZO_VENCIDO',
  'CAMPOS_INCOMPATIVEIS',
  'VALOR_FORA_DO_LIMITE',
  'SALDO_INSUFICIENTE',
  'SEM_CREDITO',
  'ORCAMENTO_VENCIDO',
  'ORCAMENTO_ALTERADO',
  'JA_PROCESSADO',
  'CHAVE_REUTILIZADA',
  'NAO_ESTORNAVEL',
  'MULTA_ALTERADA',
  'DIVERGENCIA_SALDO',
  'TETO_DIARIO',
  'FORA_DA_JANELA',
  'OUTRA_EM_ANDAMENTO',
  'PREVISAO_INVALIDA',
  'LIMITE_ETA',
  'FOTO_INVALIDA',
  'LIMITE_FOTOS',
  'VEICULO_INVALIDO',
  'PLACA_DUPLICADA',
  'CATEGORIA_INDISPONIVEL',
  'AJUSTE_FORA_DO_LIMITE',
  'MOTIVO_INVALIDO',
  'CENTRO_CUSTO_INVALIDO',
  'JA_AVALIADO',
  'NOTA_INVALIDA',
  'TELEFONE_INVALIDO',
  'VALOR_INVALIDO',
  'CATEGORIA_DUPLICADA',
  'NAO_FATURADO',
  'QUINZENA_INVALIDA',
  'QUINZENA_EM_ANDAMENTO',
  'NADA_A_FATURAR',
  'FATURA_PAGA',
  'FATURA_CANCELADA',
  'CATEGORIA_EM_USO',
  'ACIMA_DA_CAPACIDADE',
  'JA_EXISTE',
  // Edge Functions
  'ERRO_AUTH',
  'ERRO_INESPERADO',
  'METODO_NAO_PERMITIDO',
  'NAO_AUTENTICADO',
  'ORIGEM_NAO_PERMITIDA',
  'SENHA_FRACA',
  'SENHA_LONGA',
  'SENHA_VAZADA',
  'VERIFICACAO_INDISPONIVEL',
  'MAPAS_INDISPONIVEL',
] as const

function arquivos(pasta: string, extensao: string): string[] {
  return readdirSync(pasta).flatMap((nome) => {
    const caminho = join(pasta, nome)
    if (statSync(caminho).isDirectory()) return arquivos(caminho, extensao)
    return caminho.endsWith(extensao) && !caminho.endsWith('.test.ts') ? [caminho] : []
  })
}

const RESULTADOS = ['OK', 'NEGADO', 'ERRO']

/** Varre as fontes do backend atrás de códigos de negação, para pegar código novo sem mensagem. */
function codigosNasFontes(): Set<string> {
  const achados = new Set<string>()
  const juntar = (texto: string, regex: RegExp) => {
    for (const m of texto.matchAll(regex)) if (m[1] && !RESULTADOS.includes(m[1])) achados.add(m[1])
  }
  for (const f of arquivos('supabase/migrations', '.sql')) {
    const sql = readFileSync(f, 'utf8')
    juntar(sql, /negar\(\s*'[A-Z_]+'\s*,\s*[^,]+?,\s*'([A-Z][A-Z0-9_]+)'/g)
    juntar(sql, /'codigo'\s*,\s*'([A-Z][A-Z0-9_]+)'/g)
    juntar(sql, /'(?:NEGADO|ERRO)'\s*,\s*'([A-Z][A-Z0-9_]+)'/g)
  }
  for (const f of arquivos('supabase/functions', '.ts')) {
    const ts = readFileSync(f, 'utf8')
    juntar(ts, /codigo:\s*'([A-Z][A-Z0-9_]+)'/g)
    juntar(ts, /'(SENHA_[A-Z_]+)'/g)
    juntar(ts, /'(?:NEGADO|ERRO)'\s*,\s*'([A-Z][A-Z0-9_]+)'/g)
  }
  return achados
}

describe('erros', () => {
  it('todo código conhecido tem mensagem pt-BR', () => {
    for (const codigo of CODIGOS_CONHECIDOS) {
      expect(MENSAGENS, codigo).toHaveProperty(codigo)
      expect(MENSAGENS[codigo].length).toBeGreaterThan(5)
    }
  })

  it('a lista acompanha as fontes do backend (código novo precisa de mensagem)', () => {
    const fontes = codigosNasFontes()
    expect(fontes.size).toBeGreaterThan(15)
    const semMensagem = [...fontes].filter((c) => !Object.hasOwn(MENSAGENS, c))
    expect(semMensagem).toEqual([])
    const foraDaLista = [...fontes].filter((c) => !(CODIGOS_CONHECIDOS as readonly string[]).includes(c))
    expect(foraDaLista).toEqual([])
  })

  it('código desconhecido ou ausente vira a mensagem genérica', () => {
    expect(mensagemDoCodigo('XYZ')).toBe(MENSAGENS.ERRO_INESPERADO)
    expect(mensagemDoCodigo(undefined)).toBe(MENSAGENS.ERRO_INESPERADO)
    expect(mensagemDoCodigo('toString')).toBe(MENSAGENS.ERRO_INESPERADO)
    expect(mensagemDoCodigo('SENHA_VAZADA')).toBe('Essa senha já apareceu em vazamentos. Escolha outra.')
  })

  it('envio do orçamento: VEICULO_INVALIDO fala do veículo que atende a categoria; o resto como sempre', () => {
    expect(mensagemAoOrcar('VEICULO_INVALIDO')).toBe(VEICULO_AO_ORCAR)
    expect(VEICULO_AO_ORCAR).toBe('Nenhum veículo ativo atende esta categoria. Cadastre ou reative um veículo.')
    // O cadastro do veículo continua com a mensagem dos campos.
    expect(mensagemDoCodigo('VEICULO_INVALIDO')).toMatch(/modelo, cor, placa/)
    expect(mensagemAoOrcar('VALOR_INVALIDO')).toBe(MENSAGENS.VALOR_INVALIDO)
    expect(MENSAGENS.VALOR_INVALIDO).toMatch(/maior que zero/)
    expect(mensagemAoOrcar('AJUSTE_FORA_DO_LIMITE')).toBe(MENSAGENS.AJUSTE_FORA_DO_LIMITE)
    expect(mensagemAoOrcar(undefined)).toBe(MENSAGENS.ERRO_INESPERADO)
  })

  it('login é genérico; 2FA e limites têm mensagem própria', () => {
    expect(mensagemErroAuth({ code: 'invalid_credentials', status: 400 })).toBe('E-mail ou senha incorretos.')
    expect(mensagemErroAuth({ code: 'user_banned', status: 400 })).toBe('E-mail ou senha incorretos.')
    expect(mensagemErroAuth({ code: 'over_request_rate_limit', status: 429 })).toBe(MENSAGENS.LIMITE_EXCEDIDO)
    expect(mensagemErroAuth({ code: 'captcha_failed' })).toMatch(/verificação de segurança/)
    expect(mensagemErroAuth({ code: 'mfa_verification_failed' }, '2fa')).toMatch(/Código incorreto/)
    expect(mensagemErroAuth({ code: 'outro' }, '2fa')).toBe(MENSAGENS.ERRO_INESPERADO)
    expect(mensagemErroAuth({ status: 422 }, 'codigo')).toMatch(/Código incorreto/)
    expect(mensagemErroAuth({ status: 422 }, '2fa')).toBe(MENSAGENS.ERRO_INESPERADO)
  })
})

describe('mensagemDoPedido (fase 4.1)', () => {
  it('CATEGORIA_INDISPONIVEL e CATEGORIA_DUPLICADA têm texto próprio', () => {
    expect(mensagemDoPedido('CATEGORIA_INDISPONIVEL')).toBe('Esta categoria está indisponível no momento. Escolha outra.')
    expect(mensagemDoPedido('CATEGORIA_DUPLICADA')).toBe('Já existe uma categoria ativa com este nome.')
  })
  it('CAMPOS_INVALIDOS com detalhe paradas, horas_estimadas ou centro_custo diz qual campo', () => {
    expect(mensagemDoPedido('CAMPOS_INVALIDOS', ['paradas'])).toBe('Confira as paradas: use até 3, cada uma com 3 a 200 caracteres.')
    expect(mensagemDoPedido('CAMPOS_INVALIDOS', ['horas_estimadas'])).toBe('Informe as horas estimadas, de 0,5 a 24, de meia em meia hora.')
    expect(mensagemDoPedido('CAMPOS_INVALIDOS', ['centro_custo'])).toBe('O centro de custo pode ter até 80 caracteres.')
  })
  it('sem detalhe conhecido, cai na mensagem geral', () => {
    expect(mensagemDoPedido('CAMPOS_INVALIDOS')).toBe(MENSAGENS.CAMPOS_INVALIDOS)
    expect(mensagemDoPedido('CAMPOS_INVALIDOS', ['origem'])).toBe(MENSAGENS.CAMPOS_INVALIDOS)
    expect(mensagemDoPedido('XPTO')).toBe(MENSAGENS.ERRO_INESPERADO)
  })
})

describe('faturas e categorias (v2.1)', () => {
  it('cada recusa nova tem texto próprio', () => {
    for (const c of ['NAO_FATURADO', 'QUINZENA_INVALIDA', 'QUINZENA_EM_ANDAMENTO', 'NADA_A_FATURAR', 'FATURA_PAGA', 'FATURA_CANCELADA', 'CATEGORIA_EM_USO', 'PDF_INVALIDO']) {
      expect(mensagemDoCodigo(c), c).not.toBe(MENSAGENS.ERRO_INESPERADO)
    }
    expect(mensagemDoCodigo('PDF_INVALIDO')).toBe('Envie a NF em PDF de até 5 MB.')
  })
  it('CAMPOS_INVALIDOS com diárias ou outros custos diz qual campo', () => {
    expect(mensagemDoPedido('CAMPOS_INVALIDOS', ['diarias_estimadas'])).toBe('Informe as diárias de 0 a 30.')
    expect(mensagemDoPedido('CAMPOS_INVALIDOS', ['outros_custos'])).toBe('Os outros custos podem ter até 120 caracteres.')
  })
})

describe('mensagemDoPedido com valores (v2.2)', () => {
  it('ACIMA_DA_CAPACIDADE preenche o limite que o banco devolve', () => {
    expect(mensagemDoPedido('ACIMA_DA_CAPACIDADE', undefined, { pessoas_max: 4 })).toBe('Esta categoria leva até 4 pessoas.')
  })
  it('sem o limite (ou inválido), a mensagem sem número', () => {
    expect(mensagemDoPedido('ACIMA_DA_CAPACIDADE')).toBe('Esta categoria leva menos pessoas.')
    expect(mensagemDoPedido('ACIMA_DA_CAPACIDADE', undefined, { pessoas_max: null })).toBe('Esta categoria leva menos pessoas.')
    expect(mensagemDoPedido('ACIMA_DA_CAPACIDADE', undefined, { pessoas_max: '' })).toBe('Esta categoria leva menos pessoas.')
  })
  it('códigos sem {chave} não mudam com valores', () => {
    expect(mensagemDoPedido('CATEGORIA_INDISPONIVEL', undefined, { pessoas_max: 4 })).toBe(MENSAGENS.CATEGORIA_INDISPONIVEL)
  })
})
