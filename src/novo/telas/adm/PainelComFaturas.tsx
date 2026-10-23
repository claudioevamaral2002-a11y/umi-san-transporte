import { Painel } from '../../../telas/adm/Painel.tsx'
import { PendenciasFaturas } from './Faturas.tsx'

/** /adm/painel no app novo: o Painel de hoje com as pendências das faturas no topo (a v1 continua sem elas). */
export function PainelComFaturas() {
  return <Painel extra={<PendenciasFaturas />} />
}
