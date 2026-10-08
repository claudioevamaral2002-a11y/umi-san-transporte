// Lógica pura e utilitários dos scripts de operação do ADM. Nada aqui imprime segredos.
import { appendFileSync } from 'node:fs'

export const SITE_URL_PADRAO = 'https://umi-san-transporte.pages.dev'

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/

export function validarEmail(bruto: string | undefined): string | null {
  const email = (bruto ?? '').trim().toLowerCase()
  return email.length <= 254 && EMAIL.test(email) ? email : null
}

export function validarNome(bruto: string | undefined): string | null {
  const nome = (bruto ?? '').trim()
  return nome.length >= 2 && nome.length <= 120 ? nome : null
}

/** Só aceita origem https (ou http em localhost) e devolve sem barra final. */
export function normalizarSiteUrl(bruto: string | undefined): string | null {
  try {
    const u = new URL(bruto ?? '')
    const ok = u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))
    return ok ? u.origin : null
  } catch {
    return null
  }
}

export function lerConfig(env: NodeJS.ProcessEnv): { url: string; chave: string; siteUrl: string } | null {
  const url = env.SUPABASE_URL
  const chave = env.SUPABASE_SERVICE_KEY
  const siteUrl = normalizarSiteUrl(env.SITE_URL ?? SITE_URL_PADRAO)
  if (!url || !chave || !siteUrl) return null
  return { url, chave, siteUrl }
}

/** Markdown do resumo da execução. É o ÚNICO lugar onde o link aparece. */
export function montarResumoLink(opcoes: { titulo: string; email: string; link: string; recuperacao: boolean }): string {
  const { titulo, email, link, recuperacao } = opcoes
  return [
    `## ${titulo}`,
    '',
    `Conta: \`${email}\`${recuperacao ? ' (link de recuperação: a senha ainda não tinha sido criada)' : ''}`,
    '',
    `**[Abrir link para criar a senha](${link})**`,
    '',
    'O link é válido por 24 h e de uso único. Não compartilhe este resumo.',
    'Se o link expirar, execute o workflow novamente.',
    '',
  ].join('\n')
}

export function escreverResumo(caminho: string | undefined, markdown: string): boolean {
  if (!caminho) return false
  appendFileSync(caminho, markdown + '\n')
  return true
}

/** Saída de falha: só o código, nunca detalhes que possam carregar segredos. */
export function falhar(codigo: string): never {
  console.error(`Falhou: ${codigo}`)
  process.exit(1)
}
