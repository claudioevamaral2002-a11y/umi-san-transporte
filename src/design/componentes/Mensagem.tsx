import type { ReactNode } from 'react'

const TIPOS = {
  erro: { cor: 'var(--status-cancelada)', icone: '!', papel: 'alert' },
  sucesso: { cor: 'var(--status-concluida)', icone: '✓', papel: 'status' },
  info: { cor: 'var(--status-agendada)', icone: 'i', papel: 'status' },
} as const

/** Mensagem em linha com ícone + texto (nunca só cor). Erro é anunciado de imediato (role=alert). */
export function Mensagem({ tipo, children }: { tipo: keyof typeof TIPOS; children: ReactNode }) {
  const t = TIPOS[tipo]
  return (
    <div
      role={t.papel}
      className="flex items-start gap-2.5 rounded-xl border bg-superficie px-3.5 py-3 text-[0.9375rem] leading-snug font-medium text-texto"
      style={{ borderColor: t.cor }}
    >
      <span
        aria-hidden="true"
        className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-fundo"
        style={{ background: t.cor }}
      >
        {t.icone}
      </span>
      <span>{children}</span>
    </div>
  )
}
