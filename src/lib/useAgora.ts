import { useEffect, useState } from 'react'

/**
 * "Agora" que muda a cada `intervaloMs` (padrão: 1 min), alinhado à virada do minuto: contagens regressivas
 * atualizam sem tagarelar no leitor de tela.
 */
export function useAgora(intervaloMs = 60_000): Date {
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    let temporizador: ReturnType<typeof setTimeout>
    const agendar = () => {
      const falta = intervaloMs - (Date.now() % intervaloMs)
      temporizador = setTimeout(() => {
        setAgora(new Date())
        agendar()
      }, falta + 50)
    }
    agendar()
    return () => clearTimeout(temporizador)
  }, [intervaloMs])
  return agora
}
