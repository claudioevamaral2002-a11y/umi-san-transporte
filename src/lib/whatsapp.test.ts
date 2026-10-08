import { describe, expect, it } from 'vitest'
import { linkSeguro, mensagemDoLink, urlWhatsApp } from './whatsapp.ts'

describe('WhatsApp', () => {
  const link = 'https://abc.supabase.co/auth/v1/verify?token=x&type=invite&redirect_to=https://app/definir-senha'

  it('mensagem com primeiro nome, aviso de validade e o link', () => {
    expect(mensagemDoLink('  Bruno  Lima ', link)).toBe(
      `Olá, Bruno! Seu acesso à IVO Transportes está pronto. Abra o link e toque em Continuar para criar sua senha (válido por 24 h, uso único): ${link}`,
    )
    expect(mensagemDoLink('', link, 'recuperacao')).toMatch(/^Olá! Aqui está o link para criar uma nova senha/)
  })

  it('link curto do app (/c/<código>) vai inteiro na mensagem', () => {
    const curto = 'https://umi-san-transporte.pages.dev/c/K7M2QX9PRT'
    expect(mensagemDoLink('Ana', curto)).toContain(`uso único): ${curto}`)
    expect(linkSeguro(curto)).toBe(curto)
  })

  it('URL wa.me sem destinatário, texto todo codificado', () => {
    const url = urlWhatsApp(mensagemDoLink('Bruno', link))
    expect(url.startsWith('https://wa.me/?text=')).toBe(true)
    const texto = new URL(url).searchParams.get('text')
    expect(texto).toContain(link)
    expect(url).not.toContain('&type=') // & do link vai codificado
  })

  it('só aceita link https (ou http local)', () => {
    expect(linkSeguro(link)).toBe(link)
    expect(linkSeguro('http://127.0.0.1:54321/auth/v1/verify?x=1')).toBe('http://127.0.0.1:54321/auth/v1/verify?x=1')
    expect(linkSeguro('javascript:alert(1)')).toBeNull()
    expect(linkSeguro('http://exemplo.com')).toBeNull()
    expect(linkSeguro(42)).toBeNull()
  })
})
