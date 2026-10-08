import { useCallback, useEffect, useRef, useState } from 'react'

interface Estado<T> {
  chave: string
  rodada: number
  dados: T | undefined
  erro: boolean
}

/**
 * Leitura simples com recarga: refaz a busca quando `chave` muda ou ao chamar `recarregar()`.
 * Durante a recarga mantém os dados anteriores (sem piscar a tela).
 */
export function useConsulta<T>(chave: string, buscar: () => Promise<T>) {
  const funcao = useRef(buscar)
  useEffect(() => {
    funcao.current = buscar
  })
  const [rodada, setRodada] = useState(0)
  const [estado, setEstado] = useState<Estado<T> | null>(null)

  useEffect(() => {
    let ativo = true
    funcao.current().then(
      (dados) => {
        if (ativo) setEstado({ chave, rodada, dados, erro: false })
      },
      () => {
        if (ativo) setEstado((a) => ({ chave, rodada, dados: a?.chave === chave ? a.dados : undefined, erro: true }))
      },
    )
    return () => {
      ativo = false
    }
  }, [chave, rodada])

  const recarregar = useCallback(() => setRodada((r) => r + 1), [])
  const mesma = estado?.chave === chave
  return {
    dados: mesma ? estado.dados : undefined,
    erro: mesma && estado.erro,
    carregando: !mesma || estado.rodada !== rodada,
    recarregar,
  }
}

/** Resposta do supabase-js → dados, ou lança (vira `erro` no `useConsulta`). */
export function exigir<T>(r: { data: T | null; error: unknown }): T {
  if (r.error || r.data === null) throw r.error ?? new Error('sem dados')
  return r.data
}
