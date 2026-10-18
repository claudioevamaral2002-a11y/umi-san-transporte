import { Link, useNavigate } from 'react-router'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { StatusBadge } from '../../design/componentes/StatusBadge.tsx'
import { useConsulta } from '../../lib/consulta.ts'
import { pedidos, type ItemPendencia } from '../../lib/pedidos.ts'
import { formatarQuando, horaDe, numeroPedido } from '../../lib/tempo.ts'
import { useTempoReal } from '../../lib/tempoReal.ts'
import { Rota } from '../pedidos/componentes.tsx'
import { SaidaMotorista } from './SaidaMotorista.tsx'

function liberadaEm(item: ItemPendencia): string {
  return new Date(Date.parse(item.inicio) - 60 * 60_000).toISOString()
}

/**
 * Motorista, Início (especificação 12.3): o próximo serviço em cartão grande. Em andamento: atalho para voltar à
 * viagem. Agendado: rota, horário e o trilho "Deslize para sair" (a partir de 1 h antes do início).
 */
export function ProximoServico() {
  const navegar = useNavigate()
  // Mesma consulta das pendências do Início (memória compartilhada pela chave).
  const { dados, recarregar } = useConsulta('inicio-pendencias-MOTORISTA', pedidos.pendencias, { cache: true })
  useTempoReal('equipe', recarregar)
  const item = dados?.proximos[0]
  if (!item) return null

  if (item.status === 'EM_ANDAMENTO') {
    return (
      <Link
        to={`/pedidos/${item.id}`}
        viewTransition
        data-testid="proximo-em-andamento"
        className="block space-y-2 rounded-cartao border-2 border-laranja bg-superficie p-4 shadow-[var(--sombra)]"
      >
        <div className="flex items-center justify-between gap-3">
          <StatusBadge status="EM_ANDAMENTO" />
          <span className="ivo-legenda text-texto-suave tabular-nums">Pedido {numeroPedido(item.numero)}</span>
        </div>
        <p className="ivo-h3">{item.destino}</p>
        {item.atrasado && (
          <p className="flex items-center gap-1.5 ivo-legenda font-bold text-alerta-texto">
            <Icone nome="alerta" tamanho={14} />
            Passou da previsão{item.fim_previsto ? ` (${horaDe(item.fim_previsto)})` : ''}: informe uma nova
          </p>
        )}
        <span className="inline-flex items-center gap-1 font-semibold text-link">
          Voltar à viagem
          <Icone nome="setaDireita" tamanho={18} />
        </span>
      </Link>
    )
  }

  return (
    <section aria-labelledby="titulo-proximo" className="space-y-2">
      <h2 id="titulo-proximo" className="px-1 ivo-sobretitulo text-texto-suave">
        Próximo serviço
      </h2>
      <Cartao className="space-y-4" data-testid="proximo-servico">
        <Link to={`/pedidos/${item.id}`} viewTransition className="block space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold tabular-nums">{formatarQuando(item.inicio)}</span>
            <span className="ivo-legenda text-texto-suave tabular-nums">
              Pedido {numeroPedido(item.numero)}
              {item.empresa_nome ? `, ${item.empresa_nome}` : ''}
            </span>
          </div>
          <Rota origem={item.origem} destino={item.destino} compacta />
        </Link>
        <SaidaMotorista
          id={item.id}
          liberadaEm={liberadaEm(item)}
          aoSair={() => navegar(`/pedidos/${item.id}`, { state: { aviso: 'Saída registrada. Boa viagem!' } })}
        />
      </Cartao>
    </section>
  )
}
