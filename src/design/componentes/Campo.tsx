import { useId, useState, type InputHTMLAttributes } from 'react'
import { Icone, type NomeIcone } from './Icone.tsx'

/** Campo de 48 px com rótulo visível, ícone à esquerda e, para senha, botão mostrar/ocultar. */
export function Campo({
  rotulo,
  icone,
  ajuda,
  type = 'text',
  className = '',
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & { rotulo: string; icone: NomeIcone; ajuda?: string }) {
  const id = useId()
  const [visivel, setVisivel] = useState(false)
  const senha = type === 'password'
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block ivo-legenda font-semibold text-texto">
        {rotulo}
      </label>
      <div className="relative">
        <Icone nome={icone} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-texto-suave" />
        <input
          {...resto}
          id={id}
          type={senha && visivel ? 'text' : type}
          aria-describedby={ajuda ? `${id}-ajuda` : undefined}
          className={`h-12 w-full rounded-xl border border-borda bg-superficie pl-11 text-base text-texto outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-texto-suave/70 focus:border-acao focus:shadow-[0_0_0_3px_rgb(255_106_0/0.25)] motion-reduce:transition-none ${senha ? 'pr-13' : 'pr-4'}`}
        />
        {senha && (
          <button
            type="button"
            onClick={() => setVisivel((v) => !v)}
            aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
            aria-pressed={visivel}
            className="absolute top-0 right-0 flex h-12 w-12 items-center justify-center rounded-r-xl text-texto-suave"
          >
            <Icone nome={visivel ? 'olhoFechado' : 'olho'} />
          </button>
        )}
      </div>
      {ajuda && (
        <p id={`${id}-ajuda`} className="mt-1.5 ivo-legenda text-texto-suave">
          {ajuda}
        </p>
      )}
    </div>
  )
}
