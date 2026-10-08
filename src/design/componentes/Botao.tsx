import type { ButtonHTMLAttributes } from 'react'

type Variante = 'principal' | 'secundario' | 'perigo'

const ESTILOS: Record<Variante, string> = {
  principal: 'bg-acao text-acao-texto',
  secundario: 'bg-superficie text-texto border border-borda',
  perigo: 'bg-[var(--status-cancelada)] text-[var(--cor-perigo-texto)]',
}

export function Botao({
  variante = 'secundario',
  type = 'button',
  className = '',
  onClick,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return (
    <button
      {...resto}
      type={type}
      onClick={(evento) => {
        if (variante === 'principal') navigator.vibrate?.(10)
        onClick?.(evento)
      }}
      className={`min-h-12 rounded-cartao px-5 ivo-botao transition-transform duration-75 active:scale-[0.97] active:brightness-95 disabled:opacity-50 ${ESTILOS[variante]} ${className}`}
    />
  )
}
