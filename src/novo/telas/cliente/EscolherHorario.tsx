import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { useConsulta } from '../../../lib/consulta.ts'
import { DURACAO_PADRAO } from '../../../lib/novoPedido.ts'
import { pedidos } from '../../../lib/pedidos.ts'
import { horaDe, hoje, somarDias } from '../../../lib/tempo.ts'
import { diaCurto } from '../../formatos.ts'

/** Dias que o seletor "Agendar" oferece (hoje e os próximos). */
export const DIAS_NO_SELETOR = 14

const PERIODOS = [
  { nome: 'Manhã', ate: 12 },
  { nome: 'Tarde', ate: 18 },
  { nome: 'Noite', ate: 24 },
] as const

/** Setas (e Home/End) numa fileira de botões radio: move a escolha e o foco para o vizinho. */
function teclasDoGrupo(e: KeyboardEvent<HTMLElement>) {
  const teclas = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!teclas.includes(e.key)) return
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
  const i = radios.indexOf(document.activeElement as HTMLButtonElement)
  if (i < 0) return
  const passo = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
  const alvo = e.key === 'Home' ? radios[0] : e.key === 'End' ? radios[radios.length - 1] : radios[i + passo]
  if (!alvo) return
  e.preventDefault()
  alvo.focus()
  alvo.click()
}

/** Dia e horário do "Agendar": faixa de dias com rolagem própria e os horários livres do dia, por período. */
export function EscolherHorario({
  dia,
  inicio,
  aoMudarDia,
  aoMudarInicio,
}: {
  dia: string
  inicio: string | null
  aoMudarDia: (d: string) => void
  aoMudarInicio: (i: string) => void
}) {
  const idDias = useId()
  const idHoras = useId()
  const faixa = useRef<HTMLDivElement>(null)
  const hojeSp = hoje()
  const dias = Array.from({ length: DIAS_NO_SELETOR }, (_, i) => somarDias(hojeSp, i))
  const livres = useConsulta(`novo-livres-${dia}`, () => pedidos.horariosLivres(dia, DURACAO_PADRAO))
  // Um bloco = a largura visível da faixa; animar ou não vem do CSS (scroll-behavior respeita movimento reduzido).
  const rolar = (sentido: 1 | -1) => faixa.current?.scrollBy({ left: sentido * faixa.current.clientWidth * 0.85 })
  const [limites, setLimites] = useState({ inicio: true, fim: false })
  const medir = () => {
    const el = faixa.current
    if (el) setLimites({ inicio: el.scrollLeft < 2, fim: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 })
  }
  useEffect(medir, [])
  const horarios = livres.dados?.horarios ?? []
  return (
    <div className="space-y-3">
      <div>
        <p id={idDias} className="mb-2 font-semibold">
          Dia
        </p>
        <div className="relative">
          <button type="button" aria-label="Dias anteriores" disabled={limites.inicio} onClick={() => rolar(-1)} className="rolagem-seta rolagem-seta-esq">
            <Icone nome="setaDireitaPequena" tamanho={18} className="rotate-180" />
          </button>
          <div
            ref={faixa}
            role="radiogroup"
            aria-labelledby={idDias}
            onKeyDown={teclasDoGrupo}
            onScroll={medir}
            className="rolagem-ivo flex min-w-0 gap-2 pb-2"
          >
            {dias.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={d === dia}
                tabIndex={d === dia ? 0 : -1}
                onClick={() => aoMudarDia(d)}
                className={`min-h-12 shrink-0 rounded-full border-[1.5px] px-4 font-semibold tabular-nums ${
                  d === dia ? 'ivo-escolhido' : 'border-borda bg-superficie text-texto'
                }`}
              >
                {d === hojeSp ? 'Hoje' : diaCurto(`${d}T15:00:00Z`)}
              </button>
            ))}
          </div>
          <button type="button" aria-label="Próximos dias" disabled={limites.fim} onClick={() => rolar(1)} className="rolagem-seta rolagem-seta-dir">
            <Icone nome="setaDireitaPequena" tamanho={18} />
          </button>
        </div>
      </div>
      <div>
        <p id={idHoras} className="mb-2 font-semibold">
          Horário
        </p>
        {livres.dados === undefined ? (
          livres.erro ? (
            <p className="ivo-legenda text-texto-suave">Não foi possível ler os horários livres agora.</p>
          ) : (
            <Skeleton className="h-12" />
          )
        ) : horarios.length === 0 ? (
          <p className="ivo-legenda text-texto-suave">Sem horário livre neste dia. Escolha outro.</p>
        ) : (
          <div
            role="radiogroup"
            aria-labelledby={idHoras}
            onKeyDown={teclasDoGrupo}
            className="max-h-[38dvh] space-y-3 overflow-y-auto overscroll-contain"
          >
            {PERIODOS.map((p, n) => {
              const de = PERIODOS[n - 1]?.ate ?? 0
              const doPeriodo = horarios.filter((h) => {
                const hora = Number(horaDe(h).slice(0, 2))
                return hora >= de && hora < p.ate
              })
              if (doPeriodo.length === 0) return null
              return (
                <div key={p.nome} data-periodo={p.nome}>
                  <p className="mb-1 ivo-legenda font-semibold text-texto-suave">{p.nome}</p>
                  <div className="grid grid-cols-4 gap-2">
                    {doPeriodo.map((h) => (
                      <button
                        key={h}
                        type="button"
                        role="radio"
                        aria-checked={h === inicio}
                        tabIndex={h === (inicio && horarios.includes(inicio) ? inicio : horarios[0]) ? 0 : -1}
                        onClick={() => aoMudarInicio(h)}
                        className={`min-h-12 rounded-full border-[1.5px] px-1 font-semibold tabular-nums ${
                          h === inicio ? 'ivo-escolhido' : 'border-borda bg-superficie text-texto'
                        }`}
                      >
                        {horaDe(h)}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
