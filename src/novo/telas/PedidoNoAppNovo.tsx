import { Navigate, useParams } from 'react-router'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { useConsulta } from '../../lib/consulta.ts'
import { pedidos } from '../../lib/pedidos.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { Pedido } from '../../telas/pedidos/Pedido.tsx'
import { destinoNoAppNovo } from '../destinoPedido.ts'

/**
 * `/pedidos/:id` no app novo (Ruling R12): abre a tela nova da situação (corrida do cliente, chamada ou viagem do
 * motorista) e, quando não há, o detalhe de hoje. Sem conseguir ler, mostra o detalhe de hoje (ele trata o erro).
 */
export function PedidoNoAppNovo() {
  const { id = '' } = useParams()
  const { perfil } = useSessao()
  const { dados, erro } = useConsulta(`novo-pedido-destino-${id}`, () => pedidos.detalhe(id))
  if (dados === undefined && !erro) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4" aria-busy="true">
        <p role="status" className="sr-only">
          Carregando o pedido…
        </p>
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  const destino = dados && perfil ? destinoNoAppNovo(perfil.papel, dados) : null
  if (destino) return <Navigate to={destino} replace />
  return <Pedido />
}
