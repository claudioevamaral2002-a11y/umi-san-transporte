import { describe, expect, it } from 'vitest'
import {
  ACOES,
  GRUPO_ACAO,
  detalheComoTexto,
  opcoesDeAcao,
  filtrarUsuarios,
  gereEquipe,
  motivoValido,
  nomeAcao,
  normalizar,
  rotuloPerfil,
  validarLogo,
} from './administracao.ts'

describe('administração', () => {
  const lista = [
    { nome: 'José Antônio', email: 'jose@exemplo.com', papel: 'MOTORISTA' as const },
    { nome: 'Carla Dias', email: 'carla@umisan.com.br', papel: 'CLIENTE' as const },
    { nome: 'Ana', email: 'ana@ivo.com', papel: 'ADM' as const },
  ]

  it('filtra por nome/e-mail sem acento e por perfil', () => {
    expect(normalizar('  JOSÉ  ')).toBe('jose')
    expect(filtrarUsuarios(lista, 'jose', 'TODOS').map((u) => u.nome)).toEqual(['José Antônio'])
    expect(filtrarUsuarios(lista, 'UMISAN', 'TODOS')).toHaveLength(1)
    expect(filtrarUsuarios(lista, '', 'ADM').map((u) => u.nome)).toEqual(['Ana'])
    expect(filtrarUsuarios(lista, 'carla', 'ADM')).toEqual([])
  })

  it('motivo de 3 a 500 caracteres', () => {
    expect(motivoValido('ok')).toBe(false)
    expect(motivoValido('  ok  ')).toBe(false)
    expect(motivoValido('Saiu da empresa')).toBe(true)
    expect(motivoValido('x'.repeat(500))).toBe(true)
    expect(motivoValido('x'.repeat(501))).toBe(false)
  })

  it('logo: PNG/WebP até 500 KB', () => {
    expect(validarLogo({ type: 'image/png', size: 1000 })).toEqual({ ok: true, extensao: 'png' })
    expect(validarLogo({ type: 'image/webp', size: 500 * 1024 })).toEqual({ ok: true, extensao: 'webp' })
    expect(validarLogo({ type: 'image/webp', size: 500 * 1024 + 1 })).toMatchObject({ ok: false })
    expect(validarLogo({ type: 'image/svg+xml', size: 10 })).toMatchObject({ ok: false, erro: /PNG ou WebP/ })
    expect(validarLogo({ type: 'image/png', size: 0 })).toMatchObject({ ok: false })
  })

  it('auditoria: ação com nome e detalhe como texto', () => {
    expect(nomeAcao('RESETAR_2FA')).toBe('Resetar 2FA')
    expect(nomeAcao('ACAO_NOVA')).toBe('ACAO_NOVA')
    expect(detalheComoTexto(null)).toBe('—')
    expect(detalheComoTexto({ a: '<b>' })).toBe('{\n  "a": "<b>"\n}')
  })

  it('perfis: gestor de frota e níveis do cliente', () => {
    expect(rotuloPerfil('GESTOR_FROTA', null)).toBe('Gestor de frota')
    expect(rotuloPerfil('CLIENTE', 1)).toBe('Cliente, Gestor da empresa (N1)')
    expect(rotuloPerfil('CLIENTE', 3)).toBe('Cliente, Visualizador (N3)')
    expect(rotuloPerfil('CLIENTE', null)).toBe('Cliente')
    expect(gereEquipe({ papel: 'CLIENTE', nivel: 1 })).toBe(true)
    expect(gereEquipe({ papel: 'CLIENTE', nivel: 2 })).toBe(false)
    expect(gereEquipe({ papel: 'ADM', nivel: null })).toBe(false)
    expect(gereEquipe(null)).toBe(false)
  })
})

describe('ações da auditoria (v2.2)', () => {
  it('toda ação conhecida tem grupo, e todo grupo tem nome', () => {
    for (const acao of Object.keys(ACOES)) expect(GRUPO_ACAO[acao], acao).toBeDefined()
    for (const acao of Object.keys(GRUPO_ACAO)) expect(ACOES[acao], acao).toBeDefined()
  })
  it('as ações de pedido, dinheiro e fatura têm nome legível', () => {
    expect(nomeAcao('CRIAR_PEDIDO')).toBe('Criar pedido')
    expect(nomeAcao('APROVAR_ORCAMENTO')).toBe('Aprovar orçamento')
    expect(nomeAcao('LANCAR_RECARGA')).toBe('Lançar recarga')
    expect(nomeAcao('GERAR_FATURA')).toBe('Gerar fatura')
  })
  it('opcoesDeAcao agrupa na ordem dos assuntos, ordena por nome e põe a desconhecida em Outras com o código', () => {
    const r = opcoesDeAcao([
      { acao: 'GERAR_FATURA', total: 2 },
      { acao: 'NOVA_ACAO_X', total: 1 },
      { acao: 'CRIAR_PEDIDO', total: 9 },
      { acao: 'APROVAR_ORCAMENTO', total: 3 },
      { acao: 'ALTERAR_PERFIL', total: 4 },
    ])
    expect(r.map((g) => g.grupo)).toEqual(['Acesso', 'Pedidos', 'Faturas', 'Outras'])
    expect(r[1]!.opcoes).toEqual([
      { valor: 'APROVAR_ORCAMENTO', rotulo: 'Aprovar orçamento', total: 3 },
      { valor: 'CRIAR_PEDIDO', rotulo: 'Criar pedido', total: 9 },
    ])
    expect(r[3]!.opcoes).toEqual([{ valor: 'NOVA_ACAO_X', rotulo: 'NOVA_ACAO_X', total: 1 }])
  })
  it('as ações novas da v2.2 têm nome e grupo', () => {
    expect(GRUPO_ACAO.ACOES_AUDITORIA).toBe('Acesso')
    expect(GRUPO_ACAO.AJUDA_CLIENTE).toBe('Pedidos')
    expect(GRUPO_ACAO.CONTATO_IVO).toBe('Pedidos')
    expect(GRUPO_ACAO.LOCAIS_EMPRESA_TODOS).toBe('Cadastros')
    expect(GRUPO_ACAO.RENOMEAR_LOCAL).toBe('Cadastros')
    expect(GRUPO_ACAO.EXCLUIR_LOCAL).toBe('Cadastros')
    for (const a of ['ACOES_AUDITORIA', 'AJUDA_CLIENTE', 'CONTATO_IVO', 'LOCAIS_EMPRESA_TODOS', 'RENOMEAR_LOCAL', 'EXCLUIR_LOCAL']) {
      expect(nomeAcao(a)).not.toBe(a)
    }
  })
  it('opcoesDeAcao com lista vazia não devolve grupo', () => {
    expect(opcoesDeAcao([])).toEqual([])
  })
})
