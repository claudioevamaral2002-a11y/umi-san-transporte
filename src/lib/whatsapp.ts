/** Texto do convite/novo link para mandar à pessoa. */
export function mensagemDoLink(nome: string, link: string, tipo: 'convite' | 'recuperacao' = 'convite'): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? ''
  const saudacao = primeiro ? `Olá, ${primeiro}!` : 'Olá!'
  const corpo =
    tipo === 'convite'
      ? 'Seu acesso à IVO Transportes está pronto. Abra o link e toque em Continuar para criar sua senha'
      : 'Aqui está o link para criar uma nova senha na IVO Transportes. Abra e toque em Continuar'
  return `${saudacao} ${corpo} (válido por 24 h, uso único): ${link}`
}

/**
 * Link `wa.me` que só ABRE o WhatsApp com o texto preenchido; a pessoa escolhe o contato e envia.
 */
export function urlWhatsApp(mensagem: string): string {
  return `https://wa.me/?text=${encodeURIComponent(mensagem)}`
}

/** O link devolvido pelas funções precisa ser https (ou http local, no desenvolvimento). */
export function linkSeguro(link: unknown): string | null {
  if (typeof link !== 'string') return null
  try {
    const u = new URL(link)
    const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost'
    return u.protocol === 'https:' || (u.protocol === 'http:' && local) ? u.toString() : null
  } catch {
    return null
  }
}
