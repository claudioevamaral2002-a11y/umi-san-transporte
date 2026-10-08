import { formatarCentavos } from '../dinheiro.ts'

export function Dinheiro({ centavos, className = '' }: { centavos: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatarCentavos(centavos)}</span>
}
