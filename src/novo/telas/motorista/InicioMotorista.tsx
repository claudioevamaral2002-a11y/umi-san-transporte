import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Botao } from '../../../design/componentes/Botao.tsx'
import { Icone } from '../../../design/componentes/Icone.tsx'
import { Mensagem } from '../../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { useConsulta } from '../../../lib/consulta.ts'
import { pedidos, type ItemPendencia } from '../../../lib/pedidos.ts'
import { saudacao } from '../../../lib/tempo.ts'
import { useTempoReal } from '../../../lib/tempoReal.ts'
import { useAgora } from '../../../lib/useAgora.ts'
import { useSessao } from '../../../lib/sessao.tsx'
import { SaidaMotorista } from '../../../telas/execucao/SaidaMotorista.tsx'
import { FolhaMapa } from '../../componentes/FolhaMapa.tsx'
import { useDisponivel } from '../../disponivel.ts'
import { prazoAte, quandoCompleto } from '../../formatos.ts'
import somDaChamada from '../../sons/chamada.wav'

/** Som e vibração da chamada (só com o app aberto até a fase 5). O navegador pode recusar o som sem um toque antes. */
function tocarChamada() {
  try {
    const audio = new Audio(somDaChamada)
    void audio.play().catch(() => undefined)
  } catch {
    // Sem áudio no aparelho: fica a vibração e a tela da chamada.
  }
  navigator.vibrate?.([300, 150, 300, 150, 300])
}

/** A saída libera 1 h antes do início (D1); o banco confere de novo. */
const liberadaEm = (item: ItemPendencia) => new Date(Date.parse(item.inicio) - 60 * 60_000).toISOString()

function ProximaCorrida({ item }: { item: ItemPendencia }) {
  const navegar = useNavigate()
  if (item.status === 'EM_ANDAMENTO') {
    return (
      <Link
        to={`/viagem/${item.id}`}
        className="block space-y-1 rounded-cartao border-2 border-laranja p-3"
        data-testid="proximo-em-andamento"
      >
        <span className="ivo-legenda font-bold text-alerta-texto">Em andamento</span>
        <span className="block font-bold break-words">{item.destino}</span>
        <span className="inline-flex items-center gap-1 font-semibold text-link">
          Voltar à viagem
          <Icone nome="setaDireita" tamanho={18} />
        </span>
      </Link>
    )
  }
  return (
    <section aria-labelledby="titulo-proxima" className="space-y-3 rounded-cartao border-[1.5px] border-borda p-3">
      <div>
        <h2 id="titulo-proxima" className="ivo-legenda font-semibold text-texto-suave">
          Próxima corrida
        </h2>
        <p className="font-bold tabular-nums">
          {quandoCompleto(item.inicio)}
          {item.empresa_nome ? ` · ${item.empresa_nome}` : ''}
        </p>
        <p className="ivo-legenda text-texto-suave break-words">
          {item.origem} → {item.destino}
        </p>
      </div>
      <SaidaMotorista id={item.id} liberadaEm={liberadaEm(item)} aoSair={() => navegar(`/viagem/${item.id}`)} />
    </section>
  )
}

/**
 * Início do motorista (especificação §6.2 e §6.4): o mapa, a próxima corrida com "Deslize para sair" e as chamadas
 * esperando resposta. Com "Disponível para chamadas" ligado, uma chamada NOVA (que chegou com a tela aberta) toca e abre
 * em tela cheia. Desligado, nada toca: a chamada só fica na lista. Nenhum dos dois compartilha a localização.
 */
export function InicioMotorista() {
  const { perfil } = useSessao()
  const disponivel = useDisponivel()
  const navegar = useNavigate()
  const local = useLocation()
  const aviso = (local.state as { aviso?: string } | null)?.aviso ?? null
  const agora = useAgora()
  const [ola] = useState(() => saudacao(new Date()))
  const { dados, erro, recarregar } = useConsulta('novo-motorista-pendencias', pedidos.pendencias)
  useTempoReal('equipe', recarregar)

  // As chamadas já conhecidas ao abrir a tela ficam na lista; só as que chegam depois tocam.
  const conhecidas = useRef<Set<string> | null>(null)
  const disponivelAgora = useRef(disponivel)
  useEffect(() => {
    disponivelAgora.current = disponivel
  }, [disponivel])
  useEffect(() => {
    if (!dados) return
    const ids = dados.aguardando_orcamento.map((c) => c.id)
    const antes = conhecidas.current
    conhecidas.current = new Set([...(antes ?? []), ...ids])
    if (!antes || !disponivelAgora.current) return
    const nova = ids.find((id) => !antes.has(id))
    if (!nova) return
    tocarChamada()
    navegar(`/chamada/${nova}`)
  }, [dados, navegar])

  const chamadas = dados?.aguardando_orcamento ?? []
  const proxima = dados?.proximos[0] ?? null
  const primeiroNome = perfil?.nome.trim().split(/\s+/)[0] ?? ''

  return (
    <FolhaMapa rotulo="Início">
      <div data-testid="inicio-motorista" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="ivo-h2">{primeiroNome ? `${ola}, ${primeiroNome}` : ola}</h1>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 ivo-legenda font-bold ${disponivel ? 'bg-selecao-suave text-texto' : 'border border-borda text-texto-suave'}`}
          >
            {disponivel ? 'Disponível para chamadas' : 'Indisponível no momento'}
          </span>
        </div>
        {aviso && (
          <Mensagem tipo="sucesso">{aviso}</Mensagem>
        )}
        {!disponivel && (
          <p className="ivo-legenda text-texto-suave">
            As chamadas não tocam. Elas continuam aqui; ligue “Disponível para chamadas” no menu ☰ para voltar a ouvir.
          </p>
        )}

        {dados === undefined ? (
          erro ? (
            <div className="space-y-2">
              <Mensagem tipo="erro">Não foi possível carregar as suas corridas agora.</Mensagem>
              <Botao className="w-full" onClick={recarregar}>
                Tentar de novo
              </Botao>
            </div>
          ) : (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-16" />
              <Skeleton className="h-24" />
            </div>
          )
        ) : (
          <>
            {chamadas.length > 0 && (
              <section aria-labelledby="titulo-chamadas" className="space-y-2">
                <h2 id="titulo-chamadas" className="ivo-legenda font-semibold text-texto-suave">
                  Chamadas esperando resposta
                </h2>
                <ul className="space-y-2">
                  {chamadas.map((c) => (
                    <li key={c.id}>
                      <Link
                        to={`/chamada/${c.id}`}
                        aria-label={`Responder a chamada: ${[c.empresa_nome, quandoCompleto(c.inicio)].filter(Boolean).join(', ')}`}
                        className="flex min-h-12 items-center justify-between gap-3 rounded-cartao border-[1.5px] border-laranja p-3"
                      >
                        <span className="min-w-0">
                          <span className="block font-bold">
                            {[c.empresa_nome, quandoCompleto(c.inicio)].filter(Boolean).join(' · ')}
                          </span>
                          {c.prazo && (
                            <span className="block ivo-legenda text-texto-suave">Responda até {prazoAte(c.prazo, agora)}</span>
                          )}
                        </span>
                        <Icone nome="setaDireita" tamanho={20} className="shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {proxima ? (
              <ProximaCorrida item={proxima} />
            ) : (
              chamadas.length === 0 && <p className="ivo-corpo text-texto-suave">Nenhuma corrida agendada por enquanto.</p>
            )}
          </>
        )}
      </div>
    </FolhaMapa>
  )
}
