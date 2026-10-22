import { useEffect, useId, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Dinheiro } from '../../../design/componentes/Dinheiro.tsx'
import { Icone, type NomeIcone } from '../../../design/componentes/Icone.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { useConsulta } from '../../../lib/consulta.ts'
import { detalhar, type Coordenada } from '../../../lib/enderecosRemoto.ts'
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
import { RotaDePara } from '../../../design/componentes/RotaDePara.tsx'
import {
  paradasAlcancadas,
  paradasDoPedido,
  paradasPendentes,
  ponto,
  pontoDaParada,
  pontosDasParadas,
  useRotaPorParadas,
  type ParadaDoPedido,
  type PedidoDaChamada,
} from './chamada.ts'

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
  const p = r.pedido as PedidoDaChamada
  const idAviso = useId()
  const [concluindo, setConcluindo] = useState(false)
  const { estado, chegada, alvo, posicao, trajeto, ciente, ficarCiente, origem, destino } = useEnvioDePosicao(p)
  const volta = alvo === 'origem'
  const paradas = paradasDoPedido(p)
  const { proxima, pendentes, partida } = useParadasDaViagem(p.id, paradas, posicao, !volta)
  const comParadas = pendentes.length > 0
  // Com paradas pela frente, a rota passa por elas na ordem (da posição atual, ou da origem antes do GPS); o trajeto do
  // cálculo da chegada vai direto ao destino e só vale quando não falta parada.
  const usarTrajeto = !comParadas && trajeto !== null
  const pontosPendentes = pendentes.flatMap((i) => {
    const pt = pontoDaParada(paradas[i]!)
    return pt ? [pt] : []
  })
  const { estado: rotaDesenhada } = useRotaPorParadas(
    usarTrajeto ? null : comParadas && partida ? partida : ponto(p, volta ? 'destino' : 'origem'),
    usarTrajeto ? null : ponto(p, volta ? 'origem' : 'destino'),
    comParadas ? pontosPendentes : [],
  )
  const linha = usarTrajeto ? trajeto.pontos : rotaDesenhada.fase === 'pronta' ? rotaDesenhada.rota.pontos : []
  const kmRestantes = usarTrajeto ? trajeto.km : rotaDesenhada.fase === 'pronta' ? rotaDesenhada.rota.km : null
  const final = volta ? origem : destino
  // O Waze e o Maps vão para a próxima parada não passada; sem nenhuma, para o destino (ou a origem, na volta). Termos
  // do Google: de uma parada do Google vai só o nome e o place_id (as coordenadas do "detalhar" ficam na memória, só
  // para os 150 m); as coordenadas só vão quando o ponto foi marcado no mapa.
  const alvoPonto = proxima
    ? { nome: proxima.parada.texto, lat: proxima.parada.lat, lng: proxima.parada.lng, place_id: proxima.parada.place_id }
    : final
  const marcaAlvo = final.lat !== null && final.lng !== null ? { lat: final.lat, lng: final.lng } : linha.at(-1)
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
          <span className="break-words">{final.nome}</span>
        </p>
      </div>
      {proxima && (
        <p className="mt-2 ivo-legenda text-texto-suave" data-testid="proxima-parada" aria-live="polite">
          Próxima parada: <span className="font-semibold text-texto">{proxima.parada.texto}</span>
        </p>
      )}
      {paradas.length > 0 && (
        <RotaDePara origem={p.origem} destino={p.destino} paradas={paradas.map((x) => x.texto)} className="mt-2" />
      )}
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
  const p = dados?.pedido as PedidoDaChamada | undefined
  const { estado: rota } = useRotaPorParadas(
    agendada && p ? ponto(p, 'origem') : null,
    agendada && p ? ponto(p, 'destino') : null,
    agendada && p ? pontosDasParadas(p) : [],
  )

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
  const p = r.pedido as PedidoDaChamada
  const paradas = paradasDoPedido(p)
  useCamadasDoMapa({ rota: pontos, destino: pontos.at(-1) })
  return (
    <FolhaMapa rotulo="Saída">
      <h1 className="ivo-h3">{p.destino}</h1>
      <p className="mb-3 ivo-legenda text-texto-suave">
        {p.empresa_nome} · saída a partir de {p.saida_liberada_em ? horaDe(p.saida_liberada_em) : '1 h antes do início'}
      </p>
      {paradas.length > 0 && (
        <RotaDePara origem={p.origem} destino={p.destino} paradas={paradas.map((x) => x.texto)} className="mb-3" />
      )}
      <SaidaMotorista id={p.id} liberadaEm={p.saida_liberada_em ?? null} aoSair={aoSair} />
    </FolhaMapa>
  )
}

/** Coordenadas das paradas do Google, por place_id, só na memória desta aba (um "detalhar" por parada). */
const coordenadasBuscadas = new Map<string, Promise<Coordenada | null>>()

function coordenadasDoGoogle(placeId: string, nome: string): Promise<Coordenada | null> {
  let promessa = coordenadasBuscadas.get(placeId)
  if (!promessa) {
    promessa = detalhar(placeId, nome, crypto.randomUUID())
      .then((l) => (l && l.lat !== null && l.lng !== null ? { lat: l.lat, lng: l.lng } : null))
      .catch(() => null)
    coordenadasBuscadas.set(placeId, promessa)
    // Falhou: a próxima abertura tenta de novo.
    void promessa.then((c) => {
      if (!c) coordenadasBuscadas.delete(placeId)
    })
  }
  return promessa
}

const chavePassadas = (id: string) => `ivo:paradas-passadas:${id}`

function lerPassadas(id: string): number[] {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(chavePassadas(id)) ?? '[]')
    return Array.isArray(v) ? v.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < 3) : []
  } catch {
    return []
  }
}

/**
 * As paradas da viagem em andamento: coordenadas (as guardadas; do Google, um "detalhar" na hora, só em memória), as já
 * passadas (a 150 m; guardadas nesta aba para sobreviver a uma recarga) e a próxima. `partida` é a posição de quando a
 * lista de pendentes mudou: a rota desenhada sai dali e passa pelas que faltam (uma consulta por parada passada).
 */
function useParadasDaViagem(id: string, paradas: ParadaDoPedido[], posicao: Coordenada | null, naIda: boolean) {
  const chaveParadas = JSON.stringify(paradas)
  const [buscadas, setBuscadas] = useState<Record<string, Coordenada | null>>({})
  useEffect(() => {
    // Na volta as paradas não contam mais: nenhum "detalhar" (cada um é cobrado).
    if (!naIda) return
    let vivo = true
    for (const x of JSON.parse(chaveParadas) as ParadaDoPedido[]) {
      if (x.lat !== null || !x.place_id) continue
      const placeId = x.place_id
      void coordenadasDoGoogle(placeId, x.texto).then((c) => {
        if (vivo) setBuscadas((b) => (placeId in b ? b : { ...b, [placeId]: c }))
      })
    }
    return () => {
      vivo = false
    }
  }, [chaveParadas, naIda])
  const coords = paradas.map((x): Coordenada | null | undefined => {
    if (x.lat !== null && x.lng !== null) return { lat: x.lat, lng: x.lng }
    if (x.place_id) return x.place_id in buscadas ? buscadas[x.place_id] : undefined
    return null
  })

  const [passadas, setPassadas] = useState<readonly number[]>(() => lerPassadas(id))
  const alcancadas = paradasAlcancadas(coords, naIda ? posicao : null, passadas)
  if (alcancadas !== passadas) setPassadas(alcancadas)
  useEffect(() => {
    try {
      sessionStorage.setItem(chavePassadas(id), JSON.stringify(passadas))
    } catch {
      // sem armazenamento: numa recarga, as paradas voltam a contar desde a primeira
    }
  }, [id, passadas])

  const pendentes = naIda ? paradasPendentes(coords, alcancadas) : []
  const chavePendentes = JSON.stringify(pendentes)
  const [partida, setPartida] = useState<{ chave: string; ponto: Coordenada } | null>(null)
  if (posicao && pendentes.length > 0 && partida?.chave !== chavePendentes) {
    setPartida({ chave: chavePendentes, ponto: { lat: Number(posicao.lat.toFixed(5)), lng: Number(posicao.lng.toFixed(5)) } })
  }
  const i = pendentes[0]
  return {
    proxima: i === undefined ? null : { parada: paradas[i]!, ponto: coords[i] ?? null },
    pendentes,
    partida: partida && partida.chave === chavePendentes ? partida.ponto : null,
  }
}
