// Status sempre com ícone + texto, nunca só cor (especificação 12.1).
export type Status =
  | 'SOLICITADA' | 'ORCADA' | 'AGENDADA' | 'EM_ANDAMENTO' | 'CONCLUIDA'
  | 'CANCELADA' | 'EXPIRADA' | 'RECUSADA' | 'REPROVADA'

const MAPA: Record<Status, { rotulo: string; cor: string; icone: string; pulsa?: boolean }> = {
  SOLICITADA: { rotulo: 'Solicitada', cor: 'var(--status-solicitada)', icone: '○' },
  ORCADA: { rotulo: 'Aguardando aprovação', cor: 'var(--status-aguardando)', icone: '◔' },
  AGENDADA: { rotulo: 'Agendada', cor: 'var(--status-agendada)', icone: '▣' },
  EM_ANDAMENTO: { rotulo: 'Em andamento', cor: 'var(--status-andamento)', icone: '▶', pulsa: true },
  CONCLUIDA: { rotulo: 'Concluída', cor: 'var(--status-concluida)', icone: '✓' },
  CANCELADA: { rotulo: 'Cancelada', cor: 'var(--status-cancelada)', icone: '✕' },
  EXPIRADA: { rotulo: 'Expirada', cor: 'var(--status-cancelada)', icone: '⌛' },
  RECUSADA: { rotulo: 'Recusada', cor: 'var(--status-cancelada)', icone: '✕' },
  REPROVADA: { rotulo: 'Reprovada', cor: 'var(--status-cancelada)', icone: '✕' },
}

export function StatusBadge({ status }: { status: Status }) {
  const s = MAPA[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-semibold"
      style={{ color: s.cor, borderColor: s.cor }}
    >
      <span aria-hidden="true" className={s.pulsa ? 'animate-pulse motion-reduce:animate-none' : ''}>
        {s.icone}
      </span>
      {s.rotulo}
    </span>
  )
}
