import { useEffect, useRef, useState } from 'react'
import { formatarCentavos } from '../dinheiro.ts'

const prefereReduzido = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Número que conta até o novo valor (especificação 12.2: "o saldo anima contando até o número novo"). Só exibição:
 * o valor final é exatamente o do servidor. Com movimento reduzido, troca direto.
 */
export function useValorAnimado(alvo: number, duracaoMs = 700): number {
  const [quadro, setQuadro] = useState<{ alvo: number; valor: number } | null>(null)
  const atual = useRef(0)
  useEffect(() => {
    if (prefereReduzido()) {
      atual.current = alvo
      return
    }
    const de = atual.current
    if (de === alvo) return
    let raf = 0
    const inicio = performance.now()
    const passo = (t: number) => {
      const p = Math.min(1, (t - inicio) / duracaoMs)
      const valor = p >= 1 ? alvo : Math.round(de + (alvo - de) * (1 - (1 - p) ** 3))
      atual.current = valor
      setQuadro({ alvo, valor })
      if (p < 1) raf = requestAnimationFrame(passo)
    }
    raf = requestAnimationFrame(passo)
    return () => cancelAnimationFrame(raf)
  }, [alvo, duracaoMs])
  if (prefereReduzido()) return alvo
  return quadro?.valor ?? 0
}

/** Valor em reais animado; leitores de tela recebem só o valor final (sem a contagem). */
export function ValorAnimado({ centavos, className = '', ...resto }: { centavos: number; className?: string; 'data-testid'?: string }) {
  const mostrado = useValorAnimado(centavos)
  return (
    <span className={`tabular-nums ${className}`} data-final={centavos} data-testid={resto['data-testid']}>
      <span aria-hidden="true">{formatarCentavos(mostrado)}</span>
      <span className="sr-only">{formatarCentavos(centavos)}</span>
    </span>
  )
}
