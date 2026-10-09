import { describe, expect, it } from 'vitest'
import { derivarEstado, rotaDoEstado, type EntradaEstado, type Perfil } from './estadoSessao.ts'
import { lerLinkDeEntrada } from './linkDeEntrada.ts'

const perfil = (extra: Partial<Perfil> = {}): Perfil => ({
  nome: 'Ana',
  papel: 'MOTORISTA',
  nivel: null,
  empresa_id: null,
  empresa_nome: null,
  empresa_logo_caminho: null,
  empresa_tem_contrato: null,
  ativo: true,
  senha_pendente: false,
  tem_2fa: true,
  ...extra,
})

const base = (extra: Partial<EntradaEstado> = {}): EntradaEstado => ({
  temSessao: true,
  perfil: perfil(),
  aalAtual: 'aal1',
  aalProximo: 'aal2',
  viaLink: false,
  ...extra,
})

describe('derivarEstado', () => {
  it('sem sessão: anônimo', () => {
    expect(derivarEstado(base({ temSessao: false }))).toBe('anonimo')
  })

  it('sem perfil ou desativado: inativo (reativar exige novo login)', () => {
    expect(derivarEstado(base({ perfil: null }))).toBe('inativo')
    expect(derivarEstado(base({ perfil: perfil({ ativo: false }) }))).toBe('inativo')
  })

  it('senha pendente ou link de convite/recuperação: definir senha (antes do 2FA)', () => {
    expect(derivarEstado(base({ perfil: perfil({ senha_pendente: true, tem_2fa: false }), aalProximo: 'aal1' }))).toBe(
      'definir_senha',
    )
    expect(derivarEstado(base({ viaLink: true, aalAtual: 'aal2' }))).toBe('definir_senha')
  })

  it('ADM/motorista sem fator: cadastrar 2FA; com fator em aal1: verificar; em aal2: pronto', () => {
    const semFator = { perfil: perfil({ papel: 'ADM', tem_2fa: false }), aalProximo: 'aal1' }
    expect(derivarEstado(base(semFator))).toBe('cadastrar_2fa')
    expect(derivarEstado(base())).toBe('verificar_2fa')
    expect(derivarEstado(base({ aalAtual: 'aal2' }))).toBe('pronto')
  })

  it('gestor de frota exige 2FA como ADM e motorista', () => {
    const gestor = perfil({ papel: 'GESTOR_FROTA', tem_2fa: false })
    expect(derivarEstado(base({ perfil: gestor, aalProximo: 'aal1' }))).toBe('cadastrar_2fa')
    expect(derivarEstado(base({ perfil: perfil({ papel: 'GESTOR_FROTA' }) }))).toBe('verificar_2fa')
    expect(derivarEstado(base({ perfil: perfil({ papel: 'GESTOR_FROTA' }), aalAtual: 'aal2' }))).toBe('pronto')
  })

  it('cliente não precisa de 2FA', () => {
    const cliente = perfil({ papel: 'CLIENTE', tem_2fa: false, empresa_id: 'e1' })
    expect(derivarEstado(base({ perfil: cliente, aalProximo: 'aal1' }))).toBe('pronto')
  })
})

describe('rotaDoEstado', () => {
  it('cada estado tem destino', () => {
    expect(rotaDoEstado('anonimo')).toBe('/entrar')
    expect(rotaDoEstado('definir_senha')).toBe('/definir-senha')
    expect(rotaDoEstado('cadastrar_2fa')).toBe('/seguranca/2fa')
    expect(rotaDoEstado('verificar_2fa')).toBe('/seguranca/2fa')
    expect(rotaDoEstado('inativo')).toBe('/sem-acesso')
    expect(rotaDoEstado('pronto')).toBe('/')
    expect(rotaDoEstado('carregando')).toBeNull()
  })
})

describe('lerLinkDeEntrada', () => {
  it('convite e recuperação levam a definir senha', () => {
    expect(lerLinkDeEntrada('#access_token=x&type=invite')).toEqual({ definirSenha: true, erro: false })
    expect(lerLinkDeEntrada('#access_token=x&type=recovery')).toEqual({ definirSenha: true, erro: false })
  })

  it('outros tipos, sem token ou vazio: nada', () => {
    expect(lerLinkDeEntrada('#access_token=x&type=magiclink').definirSenha).toBe(false)
    expect(lerLinkDeEntrada('#type=invite').definirSenha).toBe(false)
    expect(lerLinkDeEntrada('')).toEqual({ definirSenha: false, erro: false })
  })

  it('link expirado/usado é erro', () => {
    expect(lerLinkDeEntrada('#error=access_denied&error_code=otp_expired').erro).toBe(true)
  })
})
