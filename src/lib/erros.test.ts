import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MENSAGENS, mensagemDoCodigo, mensagemErroAuth } from './erros.ts'

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
