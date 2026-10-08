export const URL_HIBP = 'https://api.pwnedpasswords.com/range/'

export class VerificacaoIndisponivel extends Error {
  constructor() {
    super('VERIFICACAO_INDISPONIVEL')
  }
}

export async function sha1Hex(texto: string): Promise<string> {
  const resumo = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(texto))
  return [...new Uint8Array(resumo)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** Procura o sufixo na resposta `SUFIXO:CONTAGEM`. Entradas de padding têm contagem 0 e são ignoradas. */
export function sufixoPresente(corpo: string, sufixo: string): boolean {
  const alvo = sufixo.toUpperCase()
  for (const linha of corpo.split(/\r?\n/)) {
    const [s, contagem] = linha.trim().split(':')
    if (s?.toUpperCase() === alvo && Number.parseInt(contagem ?? '', 10) > 0) return true
  }
  return false
}

/**
 * k-anonimato: só os 5 primeiros caracteres do SHA-1 saem. `true` se a senha consta de vazamentos.
 * Qualquer falha (rede, status, tempo > `limiteMs`) lança `VerificacaoIndisponivel` (falha fechada).
 */
export async function senhaVazada(
  senha: string,
  buscar: typeof fetch = fetch,
  limiteMs = 5000,
): Promise<boolean> {
  const hash = await sha1Hex(senha)
  const controle = new AbortController()
  const temporizador = setTimeout(() => controle.abort(), limiteMs)
  try {
    const resposta = await buscar(`${URL_HIBP}${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: controle.signal,
    })
    if (!resposta.ok) throw new VerificacaoIndisponivel()
    return sufixoPresente(await resposta.text(), hash.slice(5))
  } catch {
    throw new VerificacaoIndisponivel()
  } finally {
    clearTimeout(temporizador)
  }
}
