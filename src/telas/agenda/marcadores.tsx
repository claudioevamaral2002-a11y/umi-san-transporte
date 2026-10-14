import type { DiaDoMes } from '../../lib/pedidos.ts'

/**
 * Marcadores do calendário (Agenda e Novo pedido): fonte única para o desenho do dia e para a legenda.
 * Forma E cor diferentes (nunca só cor): ponto azul = seu pedido; triângulo laranja-texto = aguardando você;
 * ponto cinza = ocupado; número riscado = dia sem horário.
 */
export type TipoMarcador = 'meu' | 'aguardando' | 'ocupado' | 'sem_horario'

export const MARCADORES: ReadonlyArray<{ tipo: TipoMarcador; rotulo: string }> = [
  { tipo: 'meu', rotulo: 'Seu pedido' },
  { tipo: 'aguardando', rotulo: 'Aguardando você' },
  { tipo: 'ocupado', rotulo: 'Ocupado' },
  { tipo: 'sem_horario', rotulo: 'Dia sem horário' },
]

/** Quais marcadores um dia mostra (a mesma regra vale para a célula e para a legenda). */
export function marcadoresDoDia(d: DiaDoMes | undefined): TipoMarcador[] {
  if (!d) return []
  const tipos: TipoMarcador[] = []
  if (d.meus > 0) tipos.push('meu')
  if (d.aguardando_voce > 0) tipos.push('aguardando')
  if (d.ocupado && !d.dia_cheio) tipos.push('ocupado')
  if (d.dia_cheio) tipos.push('sem_horario')
  return tipos
}

/** Cores em tokens (tokens.css): #1E4B7A, #C2410C e cinza-azulado no claro; versões claras no escuro. */
const COR: Record<Exclude<TipoMarcador, 'sem_horario'>, string> = {
  meu: 'var(--marcador-meu)',
  aguardando: 'var(--marcador-aguardando)',
  ocupado: 'var(--marcador-ocupado)',
}

/**
 * Desenho de um marcador de ponto/triângulo. `contorno` (dia escolhido) põe um aro na cor do texto da seleção
 * para o marcador continuar visível sobre o fundo do dia escolhido.
 */
export function Marca({ tipo, contorno = false }: { tipo: Exclude<TipoMarcador, 'sem_horario'>; contorno?: boolean }) {
  const traco = contorno ? { stroke: 'var(--cor-selecao-texto)', strokeWidth: 1.5 } : {}
  return (
    <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true" data-marcador={tipo} className="block shrink-0">
      {tipo === 'aguardando' ? (
        <path d="M4 0.75 7.5 7.25H0.5z" fill={COR[tipo]} {...traco} strokeLinejoin="round" />
      ) : (
        <circle cx="4" cy="4" r={contorno ? 3.25 : 3.5} fill={COR[tipo]} {...traco} />
      )}
    </svg>
  )
}

/** Legenda: só os tipos que aparecem no mês mostrado (cada marcador visível tem legenda e vice-versa). */
export function LegendaCalendario({ tipos }: { tipos: ReadonlySet<TipoMarcador> }) {
  const itens = MARCADORES.filter((m) => tipos.has(m.tipo))
  if (itens.length === 0) return null
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 ivo-legenda text-texto-suave" aria-label="Legenda" data-testid="legenda-calendario">
      {itens.map((m) => (
        <li key={m.tipo} className="flex items-center gap-1.5" data-legenda={m.tipo}>
          {m.tipo === 'sem_horario' ? (
            <span aria-hidden="true" className="text-xs font-semibold text-texto-suave line-through tabular-nums">
              12
            </span>
          ) : (
            <Marca tipo={m.tipo} />
          )}
          {m.rotulo}
        </li>
      ))}
    </ul>
  )
}
