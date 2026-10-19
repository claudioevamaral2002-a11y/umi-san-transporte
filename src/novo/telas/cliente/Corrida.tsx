import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Dinheiro } from '../../../design/componentes/Dinheiro.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { StatusBadge } from '../../../design/componentes/StatusBadge.tsx'
import { useConsulta } from '../../../lib/consulta.ts'
import { pontoDaRota } from '../../../lib/enderecosRemoto.ts'
import { pedidos, type DetalhePedido, type RespostaPedido } from '../../../lib/pedidos.ts'
import { useSessao } from '../../../lib/sessao.tsx'
import { useTempoReal } from '../../../lib/tempoReal.ts'
import { podeCriarPedido } from '../../../telas/pedidos/Pedidos.tsx'
import type { Aprovacao } from '../../../telas/pedidos/Aprovar.tsx'
import { useAcompanhamento } from '../../acompanhamento.ts'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { useCamadasDoMapa } from '../../MolduraNova.tsx'
import { useRota } from '../../useRota.ts'
import { Acompanhar } from './Acompanhar.tsx'
import { Aguardando, TrilhoCorrida } from './Aguardando.tsx'
import { Concluida } from './Concluida.tsx'
import { ConfirmarCorrida } from './ConfirmarCorrida.tsx'

/** Sem o evento em tempo real (rede instável), relê o pedido a cada 30 s enquanto espera o Ivo. */
const RELEITURA_MS = 30_000

const ponto = (p: DetalhePedido, lado: 'origem' | 'destino') =>
  pontoDaRota({
    lat: p[`${lado}_lat`] ?? null,
    lng: p[`${lado}_lng`] ?? null,
    place_id: p[`${lado}_place_id`] ?? null,
  })

const LinkInicio = () => (
  <Link to="/" className="flex min-h-12 w-full items-center justify-center rounded-botao border border-borda bg-superficie px-5 ivo-botao text-texto">
    Voltar ao início
  </Link>
)

/** Depois da confirmação (ou ao abrir uma corrida já agendada): o que foi reservado e quem vai. */
function CorridaConfirmada({ r, aprovacao }: { r: RespostaPedido; aprovacao: Aprovacao | null }) {
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => titulo.current?.focus(), [])
  const p = r.pedido
  return (
    <FolhaMapa rotulo="Corrida confirmada">
      <div className="mb-3 flex items-center gap-3">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--status-agendada)] text-white">
          <Icone nome="check" />
        </span>
        <h1 ref={titulo} tabIndex={-1} className="ivo-h2 outline-none">
          Corrida confirmada
        </h1>
      </div>
      <TrilhoCorrida r={r} />
      <dl className="mt-3 space-y-1.5">
        {p.motorista_nome && (
          <div className="flex justify-between gap-3">
            <dt className="text-texto-suave">Motorista</dt>
            <dd className="text-right font-semibold">
              {p.motorista_nome}
              {p.veiculo && ` · ${p.veiculo.modelo} ${p.veiculo.cor} · ${p.veiculo.placa}`}
            </dd>
          </div>
        )}
        {aprovacao && (
          <div className="flex justify-between gap-3">
            <dt className="text-texto-suave">Reservado no saldo</dt>
            <dd className="font-semibold tabular-nums">
              <Dinheiro centavos={aprovacao.reservado_cent} />
            </dd>
          </div>
        )}
        {p.centro_custo && (
          <div className="flex justify-between gap-3">
            <dt className="text-texto-suave">Centro de custo</dt>
            <dd className="text-right font-semibold break-words">{p.centro_custo}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 ivo-legenda text-texto-suave">A cobrança acontece na saída do Ivo. O valor fica reservado até lá.</p>
      <div className="mt-3">
        <LinkInicio />
      </div>
    </FolhaMapa>
  )
}

/** Outras situações (recusado, cancelado, expirado, em andamento…): o resumo e a volta ao início. */
function OutraSituacao({ r }: { r: RespostaPedido }) {
  return (
    <FolhaMapa rotulo="Corrida">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="ivo-h2">Corrida</h1>
        <StatusBadge status={r.pedido.status} />
      </div>
      <TrilhoCorrida r={r} />
      <div className="mt-3">
        <LinkInicio />
      </div>
    </FolhaMapa>
  )
}

/**
 * `/corrida/:id` do cliente: lê o pedido e mostra a etapa (aguardando o Ivo, confirmar a proposta ou confirmada). Relê a
 * cada evento do pedido; o evento nunca é usado como dado.
 */
export function CorridaCliente() {
  const { id = '' } = useParams()
  const { dados, erro, recarregar } = useConsulta(`novo-corrida-${id}`, () => pedidos.detalhe(id))
  const [aprovacao, setAprovacao] = useState<Aprovacao | null>(null)
  useTempoReal(id ? `atividade:${id}` : null, recarregar)

  const status = dados?.pedido.status
  useEffect(() => {
    if (status !== 'SOLICITADA') return
    const t = setInterval(recarregar, RELEITURA_MS)
    return () => clearInterval(t)
  }, [status, recarregar])

  const p = dados?.pedido
  const { estado: rota } = useRota(p ? ponto(p, 'origem') : null, p ? ponto(p, 'destino') : null)
  const pontos = rota.fase === 'pronta' ? rota.rota.pontos : []
  const destino =
    pontos.at(-1) ?? (p && p.destino_lat != null && p.destino_lng != null ? { lat: p.destino_lat, lng: p.destino_lng } : undefined)
  const { perfil } = useSessao()
  const acompanhamento = useAcompanhamento(p, rota.fase === 'pronta' ? rota.rota.minutos : null)
  const { posicao } = acompanhamento
  useCamadasDoMapa({
    rota: pontos,
    destino,
    carro: posicao ? { lat: posicao.lat, lng: posicao.lng, perdido: acompanhamento.sinal === 'perdido' } : undefined,
  })

  if (dados === undefined) {
    return (
      <FolhaMapa rotulo="Corrida">
        {erro ? (
          <div className="space-y-3">
            <Mensagem tipo="erro">Não foi possível abrir esta corrida agora.</Mensagem>
            <Botao className="w-full" onClick={recarregar}>
              Tentar de novo
            </Botao>
            <LinkInicio />
          </div>
        ) : (
          <div className="space-y-2" aria-busy="true">
            <p role="status" className="sr-only">
              Carregando a corrida…
            </p>
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-24" />
          </div>
        )}
      </FolhaMapa>
    )
  }

  if (aprovacao || dados.pedido.status === 'AGENDADA') return <CorridaConfirmada r={dados} aprovacao={aprovacao} />
  if (dados.pedido.status === 'SOLICITADA') return <Aguardando r={dados} aoMudar={recarregar} />
  if (dados.pedido.status === 'ORCADA') {
    return (
      <ConfirmarCorrida
        r={dados}
        km={rota.fase === 'pronta' ? rota.rota.km : null}
        aoConfirmado={(a) => {
          setAprovacao(a)
          recarregar()
        }}
        aoMudou={recarregar}
      />
    )
  }
  if (dados.pedido.status === 'EM_ANDAMENTO') return <Acompanhar r={dados} a={acompanhamento} />
  if (dados.pedido.status === 'CONCLUIDA') return <Concluida r={dados} podePedir={podeCriarPedido(perfil)} aoMudar={recarregar} />
  return <OutraSituacao r={dados} />
}
