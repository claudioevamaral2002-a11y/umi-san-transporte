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
import { dinheiro } from '../../../lib/saldo.ts'
import { useSessao } from '../../../lib/sessao.tsx'
import { useTempoReal } from '../../../lib/tempoReal.ts'
import { podeCriarPedido } from '../../../telas/pedidos/Pedidos.tsx'
import type { Aprovacao } from '../../../telas/pedidos/Aprovar.tsx'
import { avisoCancelamento, FolhaCancelarAgendado } from '../../../telas/pedidos/CancelarAgendado.tsx'
import { useAcompanhamento } from '../../acompanhamento.ts'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { useCamadasDoMapa } from '../../MolduraNova.tsx'
import { paradasDoDetalhe } from './paradasDoDetalhe.ts'
import { useRotaComParadas } from './rotaComParadas.ts'
import { Acompanhar } from './Acompanhar.tsx'
import { Aguardando, TrilhoCorrida } from './Aguardando.tsx'
import { Concluida } from './Concluida.tsx'
import { DetalhesPedido } from './DetalhesPedido.tsx'
import { Encerrada } from './Encerrada.tsx'
import { ConfirmarCorrida } from './ConfirmarCorrida.tsx'

/** Sem o evento em tempo real (rede instável), relê o pedido a cada 30 s enquanto espera o Ivo. */
const RELEITURA_MS = 30_000

/** v2.2: encerradas sem serviço abrem a tela "Encerrada" (o que foi cobrado, o motivo e o orçamento não cobrado). */
const ENCERRADAS = new Set<string>(['CANCELADA', 'EXPIRADA', 'RECUSADA', 'REPROVADA'])

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

/**
 * Depois da confirmação (ou ao abrir uma corrida já agendada): o que foi reservado e quem vai. v2.1: no Faturado (NF),
 * a corrida "entra na fatura" em vez de ficar reservada no saldo. A forma de cobrança vem do detalhe do pedido (todos
 * os níveis, inclusive o N3, que não lê o saldo); sem ela (banco anterior), do saldo da empresa (só quem pede o lê; o N3
 * fica com o texto do Crédito).
 */
function CorridaConfirmada({
  r,
  aprovacao,
  aoMudou,
  aoAvisar,
}: {
  r: RespostaPedido
  aprovacao: Aprovacao | null
  aoMudou: () => void
  /** O resultado do cancelamento, mostrado na tela seguinte (Encerrada), como no detalhe de hoje. */
  aoAvisar: (aviso: string) => void
}) {
  const [cancelando, setCancelando] = useState(false)
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => titulo.current?.focus(), [])
  const p = r.pedido
  const { perfil } = useSessao()
  const doDetalhe = p.forma_cobranca ?? null
  const leSaldo = doDetalhe === null && podeCriarPedido(perfil)
  const saldo = useConsulta(leSaldo ? 'novo-saldo-corrida' : 'novo-saldo-nada', async () => (leSaldo ? dinheiro.saldo(null) : null))
  // `null` enquanto o saldo carrega (nada de texto que mude em seguida); sem saldo (N3 ou falha), o texto do Crédito.
  const forma =
    doDetalhe ?? (!leSaldo || saldo.erro ? 'CREDITO' : saldo.dados === undefined ? null : (saldo.dados?.forma_cobranca ?? 'CREDITO'))
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
      <div className="mt-3">
        <DetalhesPedido r={r} semCentroCusto />
      </div>
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
        {aprovacao && forma === 'CREDITO' && (
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
      {forma === 'FATURADO' ? (
        <p className="mt-3 ivo-legenda text-texto-suave">Entra na fatura da quinzena quando a corrida começar</p>
      ) : forma === 'CREDITO' ? (
        <p className="mt-3 ivo-legenda text-texto-suave">A cobrança acontece na saída do Ivo. O valor fica reservado até lá.</p>
      ) : null}
      <div className="mt-3 space-y-3">
        {r.acoes.cancelar_agendado && (
          <Botao className="w-full" onClick={() => setCancelando(true)}>
            Cancelar agendamento
          </Botao>
        )}
        <LinkInicio />
      </div>
      {/* v2.2: a agendada abre aqui (antes, no detalhe de hoje): o cancelamento com a multa calculada no servidor vem junto. */}
      <FolhaCancelarAgendado
        aberta={cancelando}
        atividade={p.id}
        numero={p.numero}
        faixas={r.orcamento?.regras?.faixas_cancelamento}
        aoFechar={() => setCancelando(false)}
        aoCancelado={(c) => {
          setCancelando(false)
          aoAvisar(avisoCancelamento(c))
          aoMudou()
        }}
        aoJaCancelado={() => {
          setCancelando(false)
          aoAvisar('Este agendamento já tinha sido cancelado.')
          aoMudou()
        }}
        aoMudou={aoMudou}
      />
    </FolhaMapa>
  )
}

/** Situação sem tela própria (não deveria acontecer): o resumo e a volta ao início. */
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
  const [aviso, setAviso] = useState<string | null>(null)
  useTempoReal(id ? `atividade:${id}` : null, recarregar)

  const status = dados?.pedido.status
  useEffect(() => {
    if (status !== 'SOLICITADA') return
    const t = setInterval(recarregar, RELEITURA_MS)
    return () => clearInterval(t)
  }, [status, recarregar])

  const p = dados?.pedido
  // Fase 4.1: a ida passa pelas paradas do pedido e a volta (ida e volta) é direta; `km` e `kmVolta` vão para a
  // prévia ("Pela tabela" da confirmação). Só a confirmação usa a volta: nas outras etapas ela nem é buscada.
  const { estado: rota, km, kmVolta } = useRotaComParadas(
    p ? ponto(p, 'origem') : null,
    p ? ponto(p, 'destino') : null,
    p ? paradasDoDetalhe(p).pontos : [],
    !!p && p.status === 'ORCADA' && p.levar && p.trazer,
  )
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

  if (ENCERRADAS.has(dados.pedido.status)) return <Encerrada r={dados} aviso={aviso} />
  if (aprovacao || dados.pedido.status === 'AGENDADA') {
    return (
      <CorridaConfirmada
        r={dados}
        aprovacao={aprovacao}
        aoMudou={() => {
          setAprovacao(null)
          recarregar()
        }}
        aoAvisar={setAviso}
      />
    )
  }
  if (dados.pedido.status === 'SOLICITADA') return <Aguardando r={dados} aoMudar={recarregar} />
  if (dados.pedido.status === 'ORCADA') {
    return (
      <ConfirmarCorrida
        r={dados}
        km={km}
        kmVolta={kmVolta}
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
