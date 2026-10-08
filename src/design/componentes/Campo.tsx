import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Icone, type NomeIcone } from './Icone.tsx'

const CAIXA =
  'w-full rounded-xl border border-borda bg-superficie text-base text-texto outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-texto-suave/70 focus:border-acao focus:shadow-[0_0_0_3px_rgb(255_106_0/0.25)] aria-[invalid=true]:border-[var(--status-cancelada)] motion-reduce:transition-none'

function Rotulo({ id, children }: { id: string; children: ReactNode }) {
  return (
    <label htmlFor={id} className="mb-1.5 block ivo-legenda font-semibold text-texto">
      {children}
    </label>
  )
}

function Rodape({ id, ajuda, erro }: { id: string; ajuda?: string; erro?: string }) {
  return (
    <>
      {erro && (
        <p id={`${id}-erro`} className="mt-1.5 ivo-legenda font-semibold text-[var(--status-cancelada)]">
          {erro}
        </p>
      )}
      {ajuda && (
        <p id={`${id}-ajuda`} className="mt-1.5 ivo-legenda text-texto-suave">
          {ajuda}
        </p>
      )}
    </>
  )
}

const descritores = (id: string, ajuda?: string, erro?: string) =>
  [erro && `${id}-erro`, ajuda && `${id}-ajuda`].filter(Boolean).join(' ') || undefined

/**
 * Campo de 48 px com rótulo visível; ícone opcional à esquerda, prefixo/sufixo ("R$", "%", "h") e, para
 * senha, botão mostrar/ocultar. Erro anunciado pelo `aria-describedby` do próprio campo.
 */
export function Campo({
  rotulo,
  icone,
  ajuda,
  erro,
  prefixo,
  sufixo,
  type = 'text',
  className = '',
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & {
  rotulo: string
  icone?: NomeIcone
  ajuda?: string
  erro?: string
  prefixo?: string
  sufixo?: string
}) {
  const id = useId()
  const [visivel, setVisivel] = useState(false)
  const senha = type === 'password'
  const esquerda = icone || prefixo ? 'pl-11' : 'pl-4'
  const direita = senha ? 'pr-13' : sufixo ? 'pr-14' : 'pr-4'
  return (
    <div className={className}>
      <Rotulo id={id}>{rotulo}</Rotulo>
      <div className="relative">
        {icone && (
          <Icone nome={icone} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-texto-suave" />
        )}
        {!icone && prefixo && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-semibold text-texto-suave"
          >
            {prefixo}
          </span>
        )}
        <input
          {...resto}
          id={id}
          type={senha && visivel ? 'text' : type}
          aria-invalid={erro ? true : resto['aria-invalid']}
          aria-describedby={descritores(id, ajuda, erro)}
          className={`h-12 ${CAIXA} ${esquerda} ${direita} ${prefixo || sufixo ? 'tabular-nums' : ''}`}
        />
        {sufixo && !senha && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 font-semibold text-texto-suave"
          >
            {sufixo}
          </span>
        )}
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
      <Rodape id={id} ajuda={ajuda} erro={erro} />
    </div>
  )
}

export function CampoSelecao({
  rotulo,
  ajuda,
  erro,
  className = '',
  children,
  ...resto
}: SelectHTMLAttributes<HTMLSelectElement> & { rotulo: string; ajuda?: string; erro?: string }) {
  const id = useId()
  return (
    <div className={className}>
      <Rotulo id={id}>{rotulo}</Rotulo>
      <select
        {...resto}
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descritores(id, ajuda, erro)}
        className={`h-12 ${CAIXA} px-3.5`}
      >
        {children}
      </select>
      <Rodape id={id} ajuda={ajuda} erro={erro} />
    </div>
  )
}

export function AreaTexto({
  rotulo,
  ajuda,
  erro,
  className = '',
  ...resto
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { rotulo: string; ajuda?: string; erro?: string }) {
  const id = useId()
  return (
    <div className={className}>
      <Rotulo id={id}>{rotulo}</Rotulo>
      <textarea
        {...resto}
        id={id}
        aria-invalid={erro ? true : undefined}
        aria-describedby={descritores(id, ajuda, erro)}
        className={`min-h-24 ${CAIXA} px-4 py-3`}
      />
      <Rodape id={id} ajuda={ajuda} erro={erro} />
    </div>
  )
}
