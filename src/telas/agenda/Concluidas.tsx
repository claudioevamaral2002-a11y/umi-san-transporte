import { Link } from 'react-router'
import type { ConcluidaAgenda } from '../../lib/pedidos.ts'
import { faixaHorario, numeroPedido } from '../../lib/tempo.ts'
import { Rota } from '../pedidos/componentes.tsx'

/** v2.2: fim da corrida na agenda (início + duração prevista). */
export const fimDaCorrida = (c: ConcluidaAgenda): string =>
  new Date(new Date(c.inicio).getTime() + c.duracao_min * 60_000).toISOString()

/** Selo cinza "Concluída" ou "Em andamento" (as corridas que já não ocupam a agenda). */
export function SeloConcluida({ status }: { status: ConcluidaAgenda['status'] }) {
  return (
    <span className="selo-concluida inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold">
      {status === 'EM_ANDAMENTO' ? 'Em andamento' : 'Concluída'}
    </span>
  )
}

/** Cartão cinza da lista do dia (visão Mês): toque abre a corrida. */
export function CartaoConcluida({ corrida: c }: { corrida: ConcluidaAgenda }) {
  return (
    <Link
      to={`/pedidos/${c.id}`}
      viewTransition
      data-testid="cartao-concluida"
      className="bloco-concluido block space-y-2 rounded-cartao p-3.5 text-texto"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="font-bold tabular-nums">
          Pedido {numeroPedido(c.numero)}, {faixaHorario(c.inicio, fimDaCorrida(c))}
        </span>
        <SeloConcluida status={c.status} />
      </span>
      <Rota origem={c.origem} destino={c.destino} compacta />
    </Link>
  )
}
