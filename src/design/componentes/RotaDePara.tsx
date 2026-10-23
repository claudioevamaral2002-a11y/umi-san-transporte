import { createContext, useContext } from 'react'

/**
 * Percurso em linhas, na ordem da viagem (especificação §6.6, mockup 4): "De" (origem) em cima, as paradas no meio e
 * "Para" (destino) embaixo. Usado nas listas de corrida do app novo.
 */
export function RotaDePara({
  origem,
  destino,
  paradas = [],
  className = '',
}: {
  origem: string
  destino: string
  paradas?: readonly string[]
  className?: string
}) {
  const linhas: Array<[rotulo: string, endereco: string]> = [
    ['De', origem],
    ...paradas.map((p): [string, string] => ['Parada', p]),
    ['Para', destino],
  ]
  return (
    <dl className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 text-sm ${className}`} data-testid="rota-de-para">
      {linhas.map(([rotulo, endereco], i) => (
        <div key={i} className="contents">
          <dt className="ivo-legenda font-bold text-texto-suave">{rotulo}</dt>
          <dd className="break-words font-semibold text-texto">{endereco}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Liga o `RotaDePara` no lugar da rota de hoje (anel → triângulo) nas telas do app atual reusadas no app novo. Fora do
 * app novo fica desligado: o app atual não muda.
 */
export const ContextoRotaDePara = createContext(false)

export const useRotaDePara = () => useContext(ContextoRotaDePara)
