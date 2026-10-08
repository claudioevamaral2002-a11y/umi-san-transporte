import { useEffect, useState } from 'react'

/** Carregamentos abaixo de 400 ms não mostram nada (especificação 12.2). */
export const ATRASO_CARREGAMENTO_MS = 400

export function useAtrasoVisivel(ativo: boolean, atrasoMs = ATRASO_CARREGAMENTO_MS): boolean {
  const [venceu, setVenceu] = useState(false)
  useEffect(() => {
    if (!ativo) return
    const temporizador = setTimeout(() => setVenceu(true), atrasoMs)
    return () => {
      clearTimeout(temporizador)
      setVenceu(false)
    }
  }, [ativo, atrasoMs])
  return ativo && venceu
}
