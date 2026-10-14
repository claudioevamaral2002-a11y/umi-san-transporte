import { Icone } from '../../design/componentes/Icone.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import type { DiaDoMes } from '../../lib/pedidos.ts'
import { diaEMes, gradeDoMes, mesDe, nomeDoMes, somarMeses } from '../../lib/tempo.ts'
import { LegendaCalendario, Marca, marcadoresDoDia, type TipoMarcador } from './marcadores.tsx'

const SEMANA = [
  { curto: 'D', nome: 'Domingo' },
  { curto: 'S', nome: 'Segunda' },
  { curto: 'T', nome: 'Terça' },
  { curto: 'Q', nome: 'Quarta' },
  { curto: 'Q', nome: 'Quinta' },
  { curto: 'S', nome: 'Sexta' },
  { curto: 'S', nome: 'Sábado' },
]

/** Nome acessível do dia (mesmo texto no mês e na faixa da semana da Agenda). */
export function descrever(dia: string, d: DiaDoMes | undefined, passado: boolean): string {
  const partes = [diaEMes(dia)]
  if (passado) partes.push('passado')
  if (d?.dia_cheio) partes.push('sem horário livre')
  if (d && d.meus > 0) partes.push(d.meus === 1 ? '1 pedido seu' : `${d.meus} pedidos seus`)
  if (d && d.aguardando_voce > 0) partes.push('aguardando você')
  if (d?.ocupado) partes.push('com horário ocupado')
  return partes.join(', ')
}

/**
 * Calendário do mês (A7): marcadores por dia (seu pedido, aguardando você, ocupado, dia sem horário), desenhados
 * e legendados pela mesma fonte (`marcadores.tsx`).
 * `escolher` (novo pedido): dias passados e cheios não são selecionáveis e não volta para meses passados.
 */
export function Calendario({
  mes,
  dias,
  selecionado,
  hoje,
  modo,
  aoSelecionar,
  aoMudarMes,
  grande = false,
}: {
  mes: string
  dias: DiaDoMes[] | undefined
  selecionado: string | null
  hoje: string
  modo: 'escolher' | 'agenda'
  aoSelecionar: (dia: string) => void
  aoMudarMes: (mes: string) => void
  /** Desktop da Agenda: células maiores com rótulos. */
  grande?: boolean
}) {
  const porDia = new Map((dias ?? []).map((d) => [d.dia, d]))
  const voltarBloqueado = modo === 'escolher' && mes <= mesDe(hoje)
  const celulas = gradeDoMes(mes)
  const nome = nomeDoMes(mes)
  // Tipos de marcador presentes no mês: a legenda mostra exatamente estes.
  const presentes = new Set<TipoMarcador>(
    celulas.flatMap((dia) => (dia ? marcadoresDoDia(porDia.get(dia)) : [])),
  )

  return (
    <section aria-label={`Calendário de ${nome}`} data-testid="calendario">
      <div className="flex items-center justify-between gap-2 pb-2">
        <button
          type="button"
          onClick={() => aoMudarMes(somarMeses(mes, -1))}
          disabled={voltarBloqueado}
          aria-label="Mês anterior"
          className="flex size-12 items-center justify-center rounded-xl text-texto hover:bg-borda/60 disabled:opacity-30"
        >
          <Icone nome="setaEsquerda" />
        </button>
        <h2 className="ivo-h3" aria-live="polite">
          {nome}
        </h2>
        <button
          type="button"
          onClick={() => aoMudarMes(somarMeses(mes, 1))}
          aria-label="Próximo mês"
          className="flex size-12 items-center justify-center rounded-xl text-texto hover:bg-borda/60"
        >
          <Icone nome="setaDireita" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1" aria-hidden="true">
        {SEMANA.map((s) => (
          <span key={s.nome} className="py-1 text-center ivo-legenda font-bold text-texto-suave">
            {grande ? <span className="hidden md:inline">{s.nome.slice(0, 3)}</span> : null}
            <span className={grande ? 'md:hidden' : ''}>{s.curto}</span>
          </span>
        ))}
      </div>

      {dias === undefined ? (
        <div className="grid grid-cols-7 gap-1" aria-busy="true" aria-label="Carregando o calendário">
          {celulas.map((_, i) => (
            <Skeleton key={i} className={grande ? 'h-12 md:h-20' : 'h-12'} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {celulas.map((dia, i) => {
            if (!dia) return <span key={`v${i}`} />
            const d = porDia.get(dia)
            const passado = dia < hoje
            const cheio = !!d?.dia_cheio
            const bloqueado = modo === 'escolher' && (passado || cheio)
            const marcado = dia === selecionado
            const ehHoje = dia === hoje
            const marcas = marcadoresDoDia(d)
            return (
              <button
                key={dia}
                type="button"
                onClick={() => aoSelecionar(dia)}
                disabled={bloqueado}
                aria-pressed={marcado}
                aria-label={descrever(dia, d, passado)}
                data-dia={dia}
                className={`relative flex flex-col items-center justify-center rounded-xl text-base font-semibold tabular-nums transition-colors duration-150 motion-reduce:transition-none ${
                  grande ? 'h-12 md:h-20 md:items-start md:justify-start md:p-2' : 'h-12'
                } ${
                  marcado
                    ? 'ivo-escolhido'
                    : cheio
                      ? 'text-texto-suave'
                      : ehHoje
                        ? 'font-extrabold text-alerta-texto hover:bg-borda/60'
                        : passado
                          ? 'text-texto-suave/50'
                          : 'text-texto hover:bg-borda/60'
                } disabled:cursor-not-allowed`}
              >
                <span
                  className={cheio ? 'line-through decoration-2' : undefined}
                  data-marcador={cheio ? 'sem_horario' : undefined}
                >
                  {Number(dia.slice(8))}
                </span>
                <span aria-hidden="true" className="flex h-2 items-center gap-0.5">
                  {marcas.map((t) => (t === 'sem_horario' ? null : <Marca key={t} tipo={t} contorno={marcado} />))}
                </span>
                {grande && d && (
                  <span aria-hidden="true" className="hidden text-left text-[11px] leading-tight font-medium no-underline md:block">
                    {cheio ? 'Cheio' : d.meus > 0 ? (d.meus === 1 ? '1 pedido' : `${d.meus} pedidos`) : d.ocupado ? 'Ocupado' : ''}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {dias !== undefined && <LegendaCalendario tipos={presentes} />}
    </section>
  )
}
