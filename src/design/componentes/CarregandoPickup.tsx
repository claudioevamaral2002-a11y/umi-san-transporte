import { useAtrasoVisivel } from '../useAtrasoVisivel.ts'

const RECORTE = 'var(--cor-fundo)'
const CASCO = 'var(--marcador-meu)'

function Roda({ cx, r }: { cx: number; r: number }) {
  const a = r - 2
  return (
    <g data-testid="pickup-roda" className="pickup-roda motion-reduce:animate-none">
      <circle cx={cx} cy="92" r={r} fill="currentColor" stroke={RECORTE} strokeWidth={r > 11 ? 3 : 0} />
      <circle cx={cx} cy="92" r={r * 0.38} fill={RECORTE} />
      <path
        d={`M${cx} ${92 - a}v5M${cx} ${92 + a - 5}v5M${cx - a} 92h5M${cx + a - 5} 92h5`}
        stroke={RECORTE}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </g>
  )
}

/**
 * Pickup com reboque levando um barco (opção A, aprovada em 14/10/2026): perfil com as curvas do V da marca,
 * selo triangular laranja na porta e as ondas do O atrás do reboque. Só o desenho, sem lógica de atraso:
 * serve ao carregamento, à splash e ao "deslize para sair" (fase 3).
 */
export function DesenhoPickup({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 120" width="240" height="90" aria-hidden="true" className={`overflow-visible text-texto ${className}`}>
      <g className="pickup-onda motion-reduce:animate-none">
        <path d="M6 70C14 64 20 64 28 70" stroke={CASCO} strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
      <g className="pickup-onda motion-reduce:animate-none">
        <path d="M2 82C10 76 16 76 24 82" stroke={CASCO} strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
      <g className="pickup-reboque motion-reduce:animate-none">
        <path data-parte="barco" d="M30 66C52 70 86 72 124 60c2-1 4 0 3 2l-8 16C92 84 60 84 40 80c-6-1-10-6-10-14z" fill={CASCO} />
        <path d="M44 66c26 2 52 0 72-6" stroke={RECORTE} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M78 66l6-20 2 20" fill="currentColor" />
        <rect x="30" y="80" width="100" height="7" rx="3" fill="currentColor" />
        <path d="M128 84h24" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <rect x="31" y="74" width="5" height="8" rx="1.5" fill="var(--cor-laranja)" />
      </g>
      <Roda cx={80} r={11} />
      <g className="pickup-corpo motion-reduce:animate-none">
        <path
          d="M150 90V60q0-4 4-4h64V36q0-7 7-7h27c7 0 11 3 15 9l12 16 24 3q10 1.5 10 11v16q0 6-6 6z"
          fill="currentColor"
        />
        <path d="M154 60h62" stroke={RECORTE} strokeWidth="2" opacity="0.35" />
        <rect x="217" y="56" width="2.4" height="30" fill={RECORTE} />
        <path d="M225 36h26c4 0 7 2 9 5l8 12h-43z" fill={RECORTE} opacity="0.92" />
        <rect x="243" y="36" width="3" height="17" fill="currentColor" />
        <path data-parte="selo" d="M232 62h16l-8 9z" fill="var(--cor-laranja)" />
        <rect x="305" y="63" width="8" height="5" rx="2" fill={RECORTE} opacity="0.9" />
        <rect x="150" y="61" width="5" height="9" rx="1.5" fill="var(--cor-laranja)" />
      </g>
      <Roda cx={180} r={13} />
      <Roda cx={286} r={13} />
      <line
        x1="-20" y1="111" x2="340" y2="111"
        stroke="currentColor" strokeWidth="3" strokeDasharray="24 16" strokeLinecap="round" opacity="0.3"
        className="pickup-estrada motion-reduce:animate-none"
      />
    </svg>
  )
}

export function CarregandoPickup({ ativo, rotulo = 'Carregando…' }: { ativo: boolean; rotulo?: string }) {
  const visivel = useAtrasoVisivel(ativo)
  return (
    <div role="status" aria-live="polite">
      {visivel && (
        <div data-testid="carregando-pickup" className="flex flex-col items-center gap-3 py-8">
          <DesenhoPickup />
          <span className="font-medium text-texto-suave">{rotulo}</span>
        </div>
      )}
    </div>
  )
}
