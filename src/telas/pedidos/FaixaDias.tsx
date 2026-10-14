import { useEffect, useRef } from 'react'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import type { DiaDoMes } from '../../lib/pedidos.ts'
import { diaDaSemanaCurto, nomeDoDia, somarDias } from '../../lib/tempo.ts'

/**
 * Faixa de dias deslizável do passo "Quando" (a partir de `inicio`, `quantos` dias). Dia sem horário fica riscado e
 * desabilitado; o escolhido usa a cor de seleção com contorno laranja.
 */
export function FaixaDias({
  inicio,
  quantos,
  selecionado,
  dias,
  aoSelecionar,
}: {
  inicio: string
  quantos: number
  selecionado: string | null
  dias: DiaDoMes[] | undefined
  aoSelecionar: (dia: string) => void
}) {
  const lista = Array.from({ length: quantos }, (_, i) => somarDias(inicio, i))
  const porDia = new Map((dias ?? []).map((d) => [d.dia, d]))
  // A faixa muda de âncora quando o dia escolhido sai dela: traz o escolhido de volta à área visível.
  const faixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    faixa.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selecionado, inicio])
  return (
    <div
      ref={faixa}
      data-testid="faixa-dias"
      className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pt-1 pb-2 [scrollbar-width:none]"
      aria-busy={dias === undefined}
    >
      {lista.map((dia) => {
        if (dias === undefined) return <Skeleton key={dia} className="h-[68px] w-[52px] shrink-0 rounded-cartao" />
        const cheio = !!porDia.get(dia)?.dia_cheio
        const marcado = dia === selecionado
        return (
          <button
            key={dia}
            type="button"
            data-dia={dia}
            aria-pressed={marcado}
            disabled={cheio}
            aria-label={`${nomeDoDia(dia)}${cheio ? ', sem horário livre' : ''}`}
            onClick={() => aoSelecionar(dia)}
            className={`flex h-[68px] w-[52px] shrink-0 snap-start flex-col items-center justify-center rounded-cartao border-[1.5px] tabular-nums transition-colors duration-150 disabled:cursor-not-allowed motion-reduce:transition-none ${
              marcado ? 'ivo-escolhido' : 'border-borda bg-superficie text-texto'
            }`}
          >
            <span className={`text-xs font-semibold ${marcado ? 'opacity-80' : 'text-texto-suave'}`}>{diaDaSemanaCurto(dia)}</span>
            <span className={`text-xl leading-tight font-bold tracking-tight ${cheio ? 'text-texto-suave line-through' : ''}`}>
              {Number(dia.slice(8))}
            </span>
          </button>
        )
      })}
    </div>
  )
}
