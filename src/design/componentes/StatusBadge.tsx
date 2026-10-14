import { Icone, type NomeIcone } from './Icone.tsx'

// Status sempre com ícone + texto, nunca só cor (especificação 12.1).
export type Status =
  | 'SOLICITADA' | 'ORCADA' | 'AGENDADA' | 'EM_ANDAMENTO' | 'CONCLUIDA'
  | 'CANCELADA' | 'EXPIRADA' | 'RECUSADA' | 'REPROVADA'

const MAPA: Record<Status, { rotulo: string; cor: string; icone: NomeIcone; pulsa?: boolean }> = {
  SOLICITADA: { rotulo: 'Solicitada', cor: 'var(--status-solicitada)', icone: 'relogio' },
  ORCADA: { rotulo: 'Aguardando aprovação', cor: 'var(--status-aguardando)', icone: 'relogio' },
  AGENDADA: { rotulo: 'Agendada', cor: 'var(--status-agendada)', icone: 'calendario' },
  EM_ANDAMENTO: { rotulo: 'Em andamento', cor: 'var(--status-andamento)', icone: 'play', pulsa: true },
  CONCLUIDA: { rotulo: 'Concluída', cor: 'var(--status-concluida)', icone: 'checkCirculo' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'var(--status-cancelada)', icone: 'fechar' },
  EXPIRADA: { rotulo: 'Expirada', cor: 'var(--status-cancelada)', icone: 'ampulheta' },
  RECUSADA: { rotulo: 'Recusada', cor: 'var(--status-cancelada)', icone: 'fechar' },
  REPROVADA: { rotulo: 'Reprovada', cor: 'var(--status-cancelada)', icone: 'fechar' },
}

export function StatusBadge({ status }: { status: Status }) {
  const s = MAPA[status]
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] leading-tight font-bold"
      style={{ color: s.cor, background: 'color-mix(in srgb, currentColor 12%, transparent)' }}
    >
      <Icone nome={s.icone} tamanho={14} className={s.pulsa ? 'animate-pulse motion-reduce:animate-none' : ''} />
      {s.rotulo}
    </span>
  )
}
