import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { AreaTexto, CampoSelecao } from '../../../design/componentes/Campo.tsx'
import { Folha } from '../../../design/componentes/Folha.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { formatarCentavos } from '../../../design/dinheiro.ts'
import { kmDaRota } from '../../../lib/categorias.ts'
import { mensagemAoOrcar, mensagemDoCodigo } from '../../../lib/erros.ts'
import { pedidos, type RespostaPedido } from '../../../lib/pedidos.ts'
import { formatarDuracao } from '../../../lib/tempo.ts'
import { useTempoReal } from '../../../lib/tempoReal.ts'
import { useAgora } from '../../../lib/useAgora.ts'
import type { Veiculo } from '../../../lib/veiculos.ts'
import { usePrevia } from '../../../telas/pedidos/usePrevia.ts'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { formatarKm, prazoAte, quandoCompleto, reaisCurto } from '../../formatos.ts'
import { useCamadasDoMapa } from '../../MolduraNova.tsx'
import {
  entradaDaChamada,
  enviarProposta,
  formDaTabela,
  paradasDoPedido,
  rotuloVeiculo,
  useChamada,
  veiculoDoCliente,
  type EstadoRotaDaChamada,
  type PedidoDaChamada,
} from './chamada.ts'
import { RotaDePara } from '../../../design/componentes/RotaDePara.tsx'

/** Depois de enviar: o início mostra este aviso (o pedido segue para o cliente confirmar). */
export const AVISO_PROPOSTA = 'Proposta enviada. O cliente confirma ou pede outro valor; você é avisado aqui.'

const LinkInicio = () => (
  <Link to="/" className="flex min-h-12 w-full items-center justify-center rounded-botao border border-borda bg-superficie px-5 ivo-botao text-texto">
    Voltar ao início
  </Link>
)

/** Quanto falta do prazo para responder (da criação do pedido até `prazo_orcar_ate`). Só visual; o texto diz a hora. */
function BarraPrazo({ de, ate, agora }: { de: string; ate: string; agora: Date }) {
  const inicio = Date.parse(de)
  const fim = Date.parse(ate)
  const resta = fim > inicio ? Math.min(1, Math.max(0, (fim - agora.getTime()) / (fim - inicio))) : 0
  return (
    <div aria-hidden="true" data-testid="prazo-chamada" className="my-3 h-1.5 overflow-hidden rounded-full bg-borda">
      <div
        className={`h-full rounded-full ${resta < 0.25 ? 'bg-[var(--status-cancelada)]' : 'bg-laranja'}`}
        style={{ width: `${Math.round(resta * 100)}%` }}
      />
    </div>
  )
}

/** "Recusar" (item secundário): o cliente vê o motivo e o horário fica livre. */
function FolhaRecusar({ aberta, id, aoFechar, aoConcluir }: { aberta: boolean; id: string; aoFechar: () => void; aoConcluir: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  async function confirmar() {
    const m = motivo.trim()
    if (m.length < 3 || m.length > 500) {
      setErro('Informe o motivo (de 3 a 500 caracteres).')
      return
    }
    setEnviando(true)
    setErro(null)
    const r = await pedidos.recusar(id, m)
    setEnviando(false)
    if (r.ok) aoConcluir()
    else setErro(mensagemDoCodigo(r.codigo))
  }
  return (
    <Folha aberta={aberta} titulo="Recusar a chamada" onFechar={aoFechar}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void confirmar()
        }}
      >
        <p className="ivo-corpo text-texto-suave">O cliente vê o motivo e o horário fica livre.</p>
        <AreaTexto rotulo="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} required minLength={3} />
        {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
        <Botao type="submit" variante="perigo" className="w-full" disabled={enviando} aria-busy={enviando}>
          Recusar a chamada
        </Botao>
      </form>
    </Folha>
  )
}

function Carregando() {
  return (
    <FolhaMapa rotulo="Nova chamada">
      <div className="space-y-2" aria-busy="true">
        <p role="status" className="sr-only">
          Carregando a chamada…
        </p>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-24" />
      </div>
    </FolhaMapa>
  )
}

/** A chamada pronta para responder (pedido SOLICITADA, dentro do prazo, motorista do pedido). */
function Responder({
  r,
  rota,
  tentarDeNovo,
  lista,
}: {
  r: RespostaPedido
  rota: EstadoRotaDaChamada
  tentarDeNovo: () => void
  lista: Veiculo[]
}) {
  const p = r.pedido as PedidoDaChamada
  // IVO Motorista (veículo do cliente): o Ivo dirige o carro da empresa, nenhum veículo da IVO é pedido nem enviado.
  const doCliente = veiculoDoCliente(p)
  const navegar = useNavigate()
  const agora = useAgora(30_000)
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => titulo.current?.focus(), [])
  const [escolhido, setEscolhido] = useState<string>(() => lista[0]?.id ?? '')
  const veiculo = lista.find((v) => v.id === escolhido) ?? lista[0] ?? null
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [recusando, setRecusando] = useState(false)

  const km = rota.fase === 'pronta' ? rota.rota.km : null
  const kmVolta = rota.fase === 'pronta' ? rota.rota.kmVolta : null
  const montado = km !== null ? entradaDaChamada(formDaTabela(p, km, kmVolta), p) : null
  // A MESMA entrada mostra o preço e vai no "Aceitar": o valor enviado é o que o motorista viu.
  const entrada = montado?.ok ? montado.entrada : null
  const tabela = usePrevia(p.id, entrada, 0)
  const total = tabela?.estado === 'ok' ? tabela.total : null

  async function aceitar() {
    if (!entrada || total === null || (!doCliente && !veiculo)) return
    setEnviando(true)
    setErro(null)
    const resposta = await enviarProposta(p.id, entrada, doCliente ? null : (veiculo?.id ?? null))
    setEnviando(false)
    if (resposta.ok) navegar('/', { replace: true, state: { aviso: AVISO_PROPOSTA } })
    else setErro(mensagemAoOrcar(resposta.codigo))
  }

  return (
    <FolhaMapa rotulo="Nova chamada">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-laranja px-2.5 py-1 ivo-legenda font-bold text-marinho">Nova chamada</span>
        {p.categoria_nome && (
          <span className="rounded-full border border-borda px-2.5 py-1 ivo-legenda font-bold">{p.categoria_nome}</span>
        )}
        {p.agora && <span className="rounded-full border border-borda px-2.5 py-1 ivo-legenda font-bold">Agora</span>}
      </div>
      <h1 ref={titulo} tabIndex={-1} className="mt-2 ivo-h3 outline-none">
        {p.empresa_nome} · {quandoCompleto(p.inicio)}
      </h1>
      <RotaDePara origem={p.origem} destino={p.destino} paradas={paradasDoPedido(p).map((x) => x.texto)} className="mt-1" />
      <p className="ivo-legenda font-semibold text-texto-suave" aria-live="polite">
        Responda até {prazoAte(p.prazo_orcar_ate, agora)}
      </p>
      {r.orcamento_anterior && (
        <div className="mt-2">
          <Mensagem tipo="info">Revisão pedida: {r.orcamento_anterior.motivo_revisao ?? 'sem motivo informado'}</Mensagem>
        </div>
      )}

      <div className="mt-3 flex items-end justify-between gap-3">
        <div aria-live="polite" aria-atomic="true">
          <span className="sr-only">Valor pela tabela: </span>
          {total !== null ? (
            <span className="ivo-valor tabular-nums" data-testid="valor-tabela">
              {formatarCentavos(total)}
            </span>
          ) : tabela?.estado === 'erro' ? (
            <span className="ivo-valor text-texto-suave">—</span>
          ) : rota.fase === 'falhou' ? (
            <span className="ivo-valor text-texto-suave">—</span>
          ) : (
            <Skeleton className="h-9 w-36" />
          )}
        </div>
        {rota.fase === 'pronta' && (
          <p className="text-right ivo-legenda text-texto-suave">
            {formatarKm(kmDaRota(rota.rota.km))}
            {rota.rota.minutos !== null && ` · ~${formatarDuracao(rota.rota.minutos)}`}
            <br />
            {p.levar && p.trazer ? 'por trecho, ida e volta' : 'pela tabela'}
          </p>
        )}
      </div>
      <BarraPrazo de={p.criada_em} ate={p.prazo_orcar_ate} agora={agora} />

      {rota.fase === 'falhou' && (
        <div className="mb-3 space-y-2">
          <Mensagem tipo="erro">Não foi possível calcular a rota agora. Tente de novo ou proponha o valor pelos itens.</Mensagem>
          <Botao className="w-full" onClick={tentarDeNovo}>
            Tentar de novo
          </Botao>
        </div>
      )}
      {tabela?.estado === 'erro' && (
        <div className="mb-3">
          <Mensagem tipo="erro">{tabela.mensagem}</Mensagem>
        </div>
      )}

      {doCliente ? null : lista.length > 0 ? (
        <CampoSelecao rotulo="Veículo" value={veiculo?.id ?? ''} onChange={(e) => setEscolhido(e.target.value)}>
          {lista.map((v) => (
            <option key={v.id} value={v.id}>
              {rotuloVeiculo(v)}
            </option>
          ))}
        </CampoSelecao>
      ) : (
        <Mensagem tipo="erro">
          Nenhum veículo ativo atende {p.categoria_nome ?? 'este pedido'}. Ative ou cadastre um em Meus veículos.
        </Mensagem>
      )}

      {erro && (
        <div className="mt-3">
          <Mensagem tipo="erro">{erro}</Mensagem>
        </div>
      )}
      <div className="mt-3 grid gap-2">
        <Botao
          variante="principal"
          className="w-full"
          onClick={() => void aceitar()}
          disabled={total === null || (!doCliente && !veiculo) || enviando}
          aria-busy={enviando}
        >
          {total !== null ? `Aceitar por ${reaisCurto(total)}` : 'Aceitar pela tabela'}
        </Botao>
        {doCliente || veiculo ? (
          <Link
            to={`/chamada/${p.id}/propor${!doCliente && veiculo ? `?veiculo=${encodeURIComponent(veiculo.id)}` : ''}`}
            className="flex min-h-12 w-full items-center justify-center rounded-botao border border-borda bg-superficie px-5 ivo-botao text-texto"
          >
            Propor outro valor
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => setRecusando(true)}
          className="min-h-12 w-full ivo-legenda font-semibold text-texto-suave underline"
        >
          Recusar
        </button>
      </div>
      <FolhaRecusar
        aberta={recusando}
        id={p.id}
        aoFechar={() => setRecusando(false)}
        aoConcluir={() => navegar('/', { replace: true, state: { aviso: 'Chamada recusada. O horário ficou livre.' } })}
      />
    </FolhaMapa>
  )
}

/**
 * Mockup 5: a chamada com o trajeto no mapa, o valor pela tabela (do contrato, por `calcular_orcamento`), o prazo e o
 * veículo sugerido. "Aceitar por R$ X" envia a tabela, sem ajuste; "Propor outro valor" abre a calculadora.
 */
export function Chamada() {
  const { id = '' } = useParams()
  const { r, erro, recarregar, rota, tentarDeNovo, veiculos } = useChamada(id)
  useTempoReal(id ? `atividade:${id}` : null, recarregar)
  const pontos = rota.fase === 'pronta' ? rota.rota.pontos : []
  const p = r?.pedido
  useCamadasDoMapa({
    rota: pontos,
    destino: pontos.at(-1) ?? (p && p.destino_lat != null && p.destino_lng != null ? { lat: p.destino_lat, lng: p.destino_lng } : undefined),
  })

  if (r === undefined || veiculos === undefined) {
    if (!erro) return <Carregando />
    return (
      <FolhaMapa rotulo="Nova chamada">
        <div className="space-y-3">
          <Mensagem tipo="erro">Não foi possível abrir esta chamada agora.</Mensagem>
          <Botao className="w-full" onClick={recarregar}>
            Tentar de novo
          </Botao>
          <LinkInicio />
        </div>
      </FolhaMapa>
    )
  }
  if (!r.acoes.orcar) {
    return (
      <FolhaMapa rotulo="Chamada">
        <h1 className="ivo-h2">Esta chamada não espera mais resposta</h1>
        <p className="mt-1 mb-3 ivo-corpo text-texto-suave">Ela foi respondida, cancelada ou o prazo venceu.</p>
        <LinkInicio />
      </FolhaMapa>
    )
  }
  if (r.pedido.modalidade !== 'VEICULO_PROPRIO' && !veiculoDoCliente(r.pedido)) {
    // Diárias do motorista (veículo do cliente sem categoria, do app atual) só no Orçar do app atual. A categoria de
    // veículo do cliente (IVO Motorista, 4.1) é cobrada pela tarifa e orçada aqui.
    return (
      <FolhaMapa rotulo="Chamada">
        <h1 className="ivo-h2">Orce este pedido no app atual</h1>
        <p className="mt-1 mb-3 ivo-corpo text-texto-suave">É um pedido com o veículo do cliente (diárias do motorista).</p>
        <LinkInicio />
      </FolhaMapa>
    )
  }
  return <Responder r={r} rota={rota} tentarDeNovo={tentarDeNovo} lista={veiculos} />
}
