import { useAtrasoVisivel } from '../useAtrasoVisivel.ts'

const RODAS = [49, 118, 182] as const

export function CarregandoPickup({ ativo, rotulo = 'Carregando…' }: { ativo: boolean; rotulo?: string }) {
  const visivel = useAtrasoVisivel(ativo)
  if (!visivel) return null
  return (
    <div role="status" aria-live="polite" data-testid="carregando-pickup" className="flex flex-col items-center gap-3 py-8">
      <svg viewBox="0 0 240 90" width="240" height="90" aria-hidden="true" className="text-texto">
        <g className="pickup-balanco motion-reduce:animate-none">
          <rect x="18" y="38" width="62" height="26" rx="4" fill="currentColor" />
          <rect x="80" y="52" width="14" height="4" fill="currentColor" />
          <path d="M94 40h46V24h34l18 18h14a6 6 0 0 1 6 6v14H94z" fill="currentColor" />
          <path d="M176 28h-30v14h44z" fill="var(--cor-fundo)" opacity="0.85" />
          <rect x="198" y="50" width="10" height="5" rx="2" fill="var(--cor-laranja)" />
        </g>
        {RODAS.map((cx) => (
          <g key={cx} data-testid="pickup-roda" className="pickup-roda motion-reduce:animate-none">
            <circle cx={cx} cy="66" r="10" fill="var(--cor-marinho)" stroke="var(--cor-papel)" strokeWidth="2" />
            <path d={`M${cx - 6} 66h12M${cx} 60v12`} stroke="var(--cor-laranja)" strokeWidth="2.5" />
          </g>
        ))}
        <line
          x1="0" y1="84" x2="240" y2="84"
          stroke="currentColor" strokeWidth="3" strokeDasharray="18 12" opacity="0.35"
          className="pickup-estrada motion-reduce:animate-none"
        />
      </svg>
      <span className="font-medium text-texto-suave">{rotulo}</span>
    </div>
  )
}
