import { Icone } from '../../design/componentes/Icone.tsx'

/** Topo das etapas de entrada: voltar (sai da conta) + sobretítulo do passo. */
export function CabecalhoEntrada({
  passo,
  aoVoltar,
  rotuloVoltar,
}: {
  passo: string
  aoVoltar: () => void
  rotuloVoltar: string
}) {
  return (
    <div className="mx-auto flex w-full max-w-md items-center gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-2">
      <button
        type="button"
        onClick={aoVoltar}
        aria-label={rotuloVoltar}
        className="flex size-12 items-center justify-center rounded-xl text-texto hover:bg-borda/60"
      >
        <Icone nome="setaEsquerda" />
      </button>
      <p className="ivo-legenda font-semibold text-texto-suave">{passo}</p>
    </div>
  )
}
