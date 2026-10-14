import { describe, expect, it } from 'vitest'
import {
  detalheComoTexto,
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
