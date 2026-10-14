import type { DiaDoMes } from '../../lib/pedidos.ts'
import { somarDias } from '../../lib/tempo.ts'
import { descrever } from './Calendario.tsx'
import { Marca, marcadoresDoDia } from './marcadores.tsx'

const LETRA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

/** Domingo da semana de `dia` (semanas de domingo a sábado, como no calendário do mês). */
export function domingoDe(dia: string): string {
  return somarDias(dia, -new Date(`${dia}T12:00:00Z`).getUTCDay())
}

/**
 * Faixa da Agenda (visões Dia e 3 dias): duas semanas a partir do domingo de `inicio`, deslizável. O escolhido usa a
 * cor de seleção com contorno laranja; hoje fica em laranja-texto; os marcadores vêm de `marcadores.tsx`.
 */
export function FaixaSemana({
  inicio,
  selecionado,
  hoje,
  dias,
  aoSelecionar,
}: {
  inicio: string
  selecionado: string
  hoje: string
  dias: DiaDoMes[] | undefined
  aoSelecionar: (dia: string) => void
}) {
  const primeiro = domingoDe(inicio)
  const lista = Array.from({ length: 14 }, (_, i) => somarDias(primeiro, i))
  const porDia = new Map((dias ?? []).map((d) => [d.dia, d]))
  return (
    <div data-testid="faixa-semana" className="-mx-4 flex snap-x snap-mandatory overflow-x-auto px-2 pb-1 [scrollbar-width:none]">
      {[0, 7].map((desde) => (
        <div key={desde} className="grid w-full shrink-0 snap-start grid-cols-7">
          {lista.slice(desde, desde + 7).map((dia, i) => {
            const d = porDia.get(dia)
            const marcado = dia === selecionado
            const marcas = marcadoresDoDia(d).filter((t) => t !== 'sem_horario')
            return (
              <div key={dia} className="flex flex-col items-center gap-1 py-1">
                <span aria-hidden="true" className="text-xs font-semibold text-texto-suave">
                  {LETRA[i]}
                </span>
                <button
                  type="button"
                  data-dia={dia}
                  aria-pressed={marcado}
                  aria-label={descrever(dia, d, dia < hoje)}
                  onClick={() => aoSelecionar(dia)}
                  className={`relative flex size-10 items-center justify-center rounded-campo text-[15px] font-bold tabular-nums transition-colors duration-150 motion-reduce:transition-none ${
                    marcado ? 'ivo-escolhido' : dia === hoje ? 'font-extrabold text-alerta-texto' : dia < hoje ? 'text-texto-suave' : 'text-texto'
                  }`}
                >
                  {Number(dia.slice(8))}
                  {marcas.length > 0 && (
                    <span aria-hidden="true" className="absolute -bottom-2 left-1/2 flex -translate-x-1/2 gap-0.5">
                      {marcas.slice(0, 2).map((t) => (
                        <Marca key={t} tipo={t as Exclude<typeof t, 'sem_horario'>} />
                      ))}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
