/** Contraste WCAG 2.x entre duas cores hex (#rrggbb). Usado pelo teste dos pares de tokens. */
function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

type Modo = 'claro' | 'escuro' | 'alto'

function declaracoes(bloco: string): Record<string, string> {
  const saida: Record<string, string> = {}
  for (const m of bloco.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) saida[m[1]!] = m[2]!.trim()
  return saida
}

function resolver(mapa: Record<string, string>): Record<string, string> {
  const valor = (k: string, n = 0): string => {
    const v = mapa[k] ?? ''
    const ref = /^var\((--[\w-]+)\)$/.exec(v)
    return ref && n < 10 ? valor(ref[1]!, n + 1) : v.toLowerCase()
  }
  return Object.fromEntries(Object.keys(mapa).map((k) => [k, valor(k)]))
}

/** Lê tokens.css: base (:root), escuro (@media dark) e alto contraste (vence o escuro). */
export function lerTokens(css: string): Record<Modo, Record<string, string>> {
  const limpo = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const base = declaracoes(/:root\s*\{([^}]*)\}/.exec(limpo)?.[1] ?? '')
  const escuro = declaracoes(/prefers-color-scheme:\s*dark\)\s*\{[^{]*\{([^}]*)\}/.exec(limpo)?.[1] ?? '')
  const alto = declaracoes(/\[data-contraste="alto"\]\s*\{([^}]*)\}/.exec(limpo)?.[1] ?? '')
  return {
    claro: resolver(base),
    escuro: resolver({ ...base, ...escuro }),
    alto: resolver({ ...base, ...escuro, ...alto }),
  }
}
