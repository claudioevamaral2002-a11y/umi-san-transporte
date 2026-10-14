import type { HTMLAttributes } from 'react'

export function Cartao({ className = '', ...resto }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...resto}
      className={`rounded-cartao bg-superficie p-4 shadow-[var(--sombra)] ${className}`}
    />
  )
}
