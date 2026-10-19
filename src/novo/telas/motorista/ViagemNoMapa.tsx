import { useId, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Dinheiro } from '../../../design/componentes/Dinheiro.tsx'
import { Icone, type NomeIcone } from '../../../design/componentes/Icone.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { useConsulta } from '../../../lib/consulta.ts'
import { linkGoogleMaps, linkWaze } from '../../../lib/execucaoExibicao.ts'
import { pedidos, type RespostaPedido } from '../../../lib/pedidos.ts'
import { horaDe } from '../../../lib/tempo.ts'
import { useTempoReal } from '../../../lib/tempoReal.ts'
import { AvisoLocalizacao, SeloGps } from '../../../telas/execucao/CompartilharLocalizacao.tsx'
import { FolhaConcluir } from '../../../telas/execucao/FolhaConcluir.tsx'
import { SaidaMotorista } from '../../../telas/execucao/SaidaMotorista.tsx'
import { useEnvioDePosicao } from '../../../telas/execucao/useEnvioDePosicao.ts'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { formatarKm } from '../../formatos.ts'
import { useCamadasDoMapa } from '../../MolduraNova.tsx'
import { useRota } from '../../useRota.ts'
import { ponto } from './chamada.ts'

/** Texto exato da especificação: o limite do PWA (com o Waze na frente, a posição para de sair). */
export const AVISO_WAZE = 'No Waze, o cliente vê "sinal perdido". Volte ao IVO quando puder.'

const BOTAO_LINK =
  'flex min-h-12 items-center justify-center gap-2 rounded-botao border border-borda bg-superficie px-3 ivo-botao text-texto'

function LinkAcao({
  href,
  icone,
  children,
  externo = true,
  descricao,
}: {
  href: string
  icone: NomeIcone
  children: string
  externo?: boolean
  descricao?: string
}) {
  return (
    <a
      href={href}
      className={BOTAO_LINK}
      aria-describedby={descricao}
      {...(externo ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      <Icone nome={icone} tamanho={20} />
      {children}
    </a>
  )
}

const LinkInicio = () => (
  <Link to="/" className={`${BOTAO_LINK} w-full`}>
    Voltar ao início
  </Link>
)

/**
 * Mockup 7: em andamento, o mapa ocupa a tela com o trajeto da posição atual até o destino (do mesmo cálculo da chegada,
 * no limite de 12 por viagem da 3B; antes do primeiro, o trajeto do pedido). Embaixo, a chegada prevista grande, os km
 * restantes e o selo da localização; Waze/Maps, Ligar e Concluir. Sem "Nova previsão" (o atraso é automático) e sem
 * instrução curva a curva (termos do Google).
 */
function EmAndamento({ r, aoMudou }: { r: RespostaPedido; aoMudou: () => void }) {
  const p = r.pedido
  const idAviso = useId()
  const [concluindo, setConcluindo] = useState(false)
  const { estado, chegada, alvo, posicao, trajeto, ciente, ficarCiente, origem, destino } = useEnvioDePosicao(p)
  const volta = alvo === 'origem'
  const { estado: rotaDoPedido } = useRota(
    trajeto ? null : ponto(p, volta ? 'destino' : 'origem'),
    trajeto ? null : ponto(p, volta ? 'origem' : 'destino'),
  )
  const linha = trajeto?.pontos ?? (rotaDoPedido.fase === 'pronta' ? rotaDoPedido.rota.pontos : [])
  const kmRestantes = trajeto?.km ?? (rotaDoPedido.fase === 'pronta' ? rotaDoPedido.rota.km : null)
  const alvoPonto = volta ? origem : destino
  const marcaAlvo = alvoPonto.lat !== null && alvoPonto.lng !== null ? { lat: alvoPonto.lat, lng: alvoPonto.lng } : linha.at(-1)
  useCamadasDoMapa({ rota: linha, destino: marcaAlvo, carro: posicao ? { ...posicao, perdido: false } : undefined })

  return (
    <FolhaMapa rotulo="Viagem em andamento">
      <h1 className="sr-only">Viagem em andamento</h1>
      <div className="mb-3">{!ciente ? <AvisoLocalizacao aoAceitar={ficarCiente} /> : <SeloGps estado={estado} />}</div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="ivo-legenda font-semibold text-texto-suave">{volta ? 'Chegada na volta' : 'Chegada ao destino'}</p>
          <p className="ivo-valor tabular-nums" data-testid="chegada-prevista" aria-live="polite" aria-atomic="true">
            {chegada ? `~${horaDe(chegada)}` : '—'}
          </p>
        </div>
        <p className="min-w-0 text-right ivo-legenda text-texto-suave">
          {kmRestantes !== null && (
            <>
              <span className="font-bold text-texto">{formatarKm(Math.round(kmRestantes * 10) / 10)}</span>
              <br />
            </>
          )}
          <span className="break-words">{alvoPonto.nome}</span>
        </p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <LinkAcao href={linkWaze(alvoPonto)} icone="local" descricao={idAviso}>
          Abrir no Waze
        </LinkAcao>
        <LinkAcao href={linkGoogleMaps(alvoPonto)} icone="mapa" descricao={idAviso}>
          Google Maps
        </LinkAcao>
        {p.contato_telefone && (
          <LinkAcao href={`tel:${p.contato_telefone.replace(/[^\d+]/g, '')}`} icone="telefone" externo={false}>
            Ligar
          </LinkAcao>
        )}
      </div>
      <p id={idAviso} className="mt-2 mb-3 ivo-legenda text-texto-suave">
        {AVISO_WAZE}
      </p>
      <Botao variante="principal" className="flex w-full items-center justify-center gap-2" onClick={() => setConcluindo(true)}>
        <Icone nome="check" tamanho={20} />
        Concluir serviço
      </Botao>
      <FolhaConcluir
        aberta={concluindo}
        pedido={p}
        aoFechar={() => setConcluindo(false)}
        aoConcluido={() => {
          setConcluindo(false)
          aoMudou()
        }}
      />
    </FolhaMapa>
  )
}

/** Fim (especificação §6.6, motorista): a conclusão da 3B e, no fim, o valor da corrida. */
function Concluida({ r }: { r: RespostaPedido }) {
  const total = r.orcamento?.total_cent
  return (
    <FolhaMapa rotulo="Serviço concluído">
      <div className="mb-3 flex items-center gap-3">
        <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--status-concluida)] text-white">
          <Icone nome="check" />
        </span>
        <h1 className="ivo-h2">Serviço concluído</h1>
      </div>
      <dl className="mb-3 space-y-1.5">
        {typeof total === 'number' && (
          <div className="flex justify-between gap-3">
            <dt className="text-texto-suave">Valor da corrida</dt>
            <dd className="font-bold tabular-nums">
              <Dinheiro centavos={total} />
            </dd>
          </div>
        )}
        {r.pedido.saiu_em && r.pedido.concluiu_em && (
          <div className="flex justify-between gap-3">
            <dt className="text-texto-suave">Saída e chegada</dt>
            <dd className="font-semibold tabular-nums">
              {horaDe(r.pedido.saiu_em)} → {horaDe(r.pedido.concluiu_em)}
            </dd>
          </div>
        )}
      </dl>
      <p className="mb-3 ivo-legenda text-texto-suave">O trajeto foi apagado e o resumo ficou no pedido.</p>
      <LinkInicio />
    </FolhaMapa>
  )
}

/** `/viagem/:id` do motorista: em andamento, a viagem no mapa; agendada, a saída; concluída, o fim com o valor. */
export function ViagemNoMapa() {
  const { id = '' } = useParams()
  const { dados, erro, recarregar } = useConsulta(`novo-viagem-${id}`, () => pedidos.detalhe(id))
  useTempoReal(id ? `atividade:${id}` : null, recarregar)
  const status = dados?.pedido.status
  const agendada = status === 'AGENDADA'
  // Mapa da saída: o trajeto do pedido (na viagem, o EmAndamento põe as camadas dele).
  const p = dados?.pedido
  const { estado: rota } = useRota(agendada && p ? ponto(p, 'origem') : null, agendada && p ? ponto(p, 'destino') : null)

  if (dados === undefined) {
    return (
      <FolhaMapa rotulo="Viagem">
        {erro ? (
          <div className="space-y-3">
            <Mensagem tipo="erro">Não foi possível abrir esta viagem agora.</Mensagem>
            <Botao className="w-full" onClick={recarregar}>
              Tentar de novo
            </Botao>
            <LinkInicio />
          </div>
        ) : (
          <div className="space-y-2" aria-busy="true">
            <p role="status" className="sr-only">
              Carregando a viagem…
            </p>
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-24" />
          </div>
        )}
      </FolhaMapa>
    )
  }
  if (status === 'EM_ANDAMENTO' && dados.acoes.concluir) return <EmAndamento r={dados} aoMudou={recarregar} />
  if (status === 'CONCLUIDA') return <Concluida r={dados} />
  if (agendada && dados.acoes.sair) {
    return (
      <SaidaNoMapa r={dados} pontos={rota.fase === 'pronta' ? rota.rota.pontos : []} aoSair={recarregar} />
    )
  }
  return (
    <FolhaMapa rotulo="Viagem">
      <h1 className="ivo-h2">Nada para dirigir agora</h1>
      <p className="mt-1 mb-3 ivo-corpo text-texto-suave">Este pedido não está em andamento.</p>
      <LinkInicio />
    </FolhaMapa>
  )
}

function SaidaNoMapa({ r, pontos, aoSair }: { r: RespostaPedido; pontos: Array<{ lat: number; lng: number }>; aoSair: () => void }) {
  const p = r.pedido
  useCamadasDoMapa({ rota: pontos, destino: pontos.at(-1) })
  return (
    <FolhaMapa rotulo="Saída">
      <h1 className="ivo-h3">{p.destino}</h1>
      <p className="mb-3 ivo-legenda text-texto-suave">
        {p.empresa_nome} · saída a partir de {p.saida_liberada_em ? horaDe(p.saida_liberada_em) : '1 h antes do início'}
      </p>
      <SaidaMotorista id={p.id} liberadaEm={p.saida_liberada_em ?? null} aoSair={aoSair} />
    </FolhaMapa>
  )
}
