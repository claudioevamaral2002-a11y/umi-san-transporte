/**
 * Guarda do redesign mobile: nada de " · " para juntar textos nem "→" nas telas (usar vírgula, quebra de linha e o
 * componente Rota). Comentários não contam; uma linha que não é texto de tela leva `// varrer-estilo: permitido (motivo)`.
 */
export function varrerEstilo(arquivos: Array<{ caminho: string; texto: string }>): string[] {
  const achados: string[] = []
  for (const { caminho, texto } of arquivos) {
    const semBlocos = texto.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    semBlocos.split('\n').forEach((linha, i) => {
      if (linha.includes('varrer-estilo: permitido')) return
      const codigo = linha.replace(/(^|[^:])\/\/.*$/, '$1')
      if (codigo.includes(' · ') || codigo.includes('→')) achados.push(`${caminho}:${i + 1}`)
    })
  }
  return achados
}
