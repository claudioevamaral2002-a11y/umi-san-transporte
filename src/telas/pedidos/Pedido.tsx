import { useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { Botao } from '../../design/componentes/Botao.tsx'
import { formatarCentavos } from '../../design/dinheiro.ts'
import { AreaTexto } from '../../design/componentes/Campo.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Dinheiro } from '../../design/componentes/Dinheiro.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { EstadoVazio, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { useConsulta } from '../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import { ErroLeitura, pedidos, type RespostaPedido } from '../../lib/pedidos.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { ROTULO_CARGA, ROTULO_MODALIDADE, ROTULO_REBOQUE, rotuloTrajeto } from '../../lib/situacao.ts'
import { formatarDuracao, formatarQuando, numeroPedido } from '../../lib/tempo.ts'
import { useTempoReal } from '../../lib/tempoReal.ts'
import { formatarDataHora } from '../../lib/valores.ts'
import { FaixasCancelamento } from '../contratos/CartoesContrato.tsx'
import { CartaoAgendado, FolhaAprovar, type Aprovacao } from './Aprovar.tsx'
import { avisoCancelamento, FolhaCancelarAgendado } from './CancelarAgendado.tsx'
import { Contagem, LinhaDoTempo, Memorial, Rota, SelosStatus } from './componentes.tsx'

type Acao = 'revisao' | 'reprovar' | 'cancelar'

const ACOES: Record<
  Acao,
  { titulo: string; botao: string; rotulo: string; ajuda: string; sucesso: string; perigo: boolean }
> = {
  revisao: {
    titulo: 'Pedir revisão',
    botao: 'Pedir revisão',
    rotulo: 'O que precisa mudar?',
    ajuda: 'O motorista recebe o pedido de volta e envia um novo orçamento.',
    sucesso: 'Revisão pedida. O motorista vai enviar um novo orçamento.',
    perigo: false,
  },
  reprovar: {
    titulo: 'Reprovar orçamento',
    botao: 'Reprovar orçamento',
    rotulo: 'Motivo (opcional)',
    ajuda: 'O pedido é encerrado e o horário fica livre.',
    sucesso: 'Orçamento reprovado. O pedido foi encerrado.',
    perigo: true,
  },
  cancelar: {
    titulo: 'Cancelar pedido',
    botao: 'Cancelar pedido',
    rotulo: 'Motivo',
    ajuda: 'Sem custo nesta etapa. O horário fica livre.',
    sucesso: 'Pedido cancelado.',
    perigo: true,
  },
}

function FolhaAcao({
  acao,
  id,
  motivoObrigatorio,
  aoFechar,
  aoConcluir,
}: {
  acao: Acao | null
  id: string
  motivoObrigatorio: boolean
  aoFechar: () => void
  aoConcluir: (mensagem: string) => void
}) {
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const def = acao ? ACOES[acao] : null
  const obrigatorio = acao === 'revisao' || (acao === 'cancelar' && motivoObrigatorio)

  async function confirmar() {
    if (!acao || !def) return
    const m = motivo.trim()
    if (obrigatorio && (m.length < 3 || m.length > 500)) {
      setErro('Informe o motivo (de 3 a 500 caracteres).')
      return
    }
    setEnviando(true)
    setErro(null)
    const r =
      acao === 'revisao'
        ? await pedidos.pedirRevisao(id, m)
        : acao === 'reprovar'
          ? await pedidos.reprovar(id, m || null)
          : await pedidos.cancelar(id, m || null)
    setEnviando(false)
    if (r.ok) {
      setMotivo('')
      aoConcluir(def.sucesso)
    } else {
      setErro(mensagemDoCodigo(r.codigo))
    }
  }

  return (
    <Folha
      aberta={acao !== null}
      titulo={def?.titulo ?? ''}
      onFechar={() => {
        setMotivo('')
        setErro(null)
        aoFechar()
      }}
    >
      {def && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void confirmar()
          }}
        >
          <p className="ivo-corpo text-texto-suave">{def.ajuda}</p>
          <AreaTexto
            rotulo={acao === 'cancelar' && !obrigatorio ? 'Motivo (opcional)' : def.rotulo}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={500}
            required={obrigatorio}
          />
          {erro && <Mensagem tipo="erro">{erro}</Mensagem>}
          <Botao type="submit" variante={def.perigo ? 'perigo' : 'principal'} className="w-full" disabled={enviando}>
            {enviando ? 'Enviando…' : def.botao}
          </Botao>
        </form>
      )}
    </Folha>
  )
}

function Linha({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="border-b border-borda py-3 last:border-b-0">
      <p className="ivo-legenda font-semibold text-texto-suave">{titulo}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function Detalhes({ r }: { r: RespostaPedido }) {
  const p = r.pedido
  const carga = [
    p.pessoas_qtd ? (p.pessoas_qtd === 1 ? '1 pessoa' : `${p.pessoas_qtd} pessoas`) : null,
    p.equipamento_desc,
    p.peso_kg ? `${p.peso_kg.toLocaleString('pt-BR')} kg` : null,
    p.dimensoes,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <Cartao className="py-1" data-testid="detalhes-pedido">
      <Linha titulo="Quando">
        <p className="font-bold tabular-nums">{formatarQuando(p.inicio)}</p>
        <p className="ivo-legenda text-texto-suave">Duração estimada: {formatarDuracao(p.duracao_min)}</p>
      </Linha>
      <Linha titulo="Onde">
        <Rota origem={p.origem} destino={p.destino} />
        <p className="mt-1.5 ivo-legenda text-texto-suave">{rotuloTrajeto(p.levar, p.trazer)}</p>
      </Linha>
      <Linha titulo="Carga">
        <p className="font-bold">{ROTULO_CARGA[p.carga]}</p>
        <p className="ivo-legenda break-words text-texto-suave">{carga}</p>
      </Linha>
      <Linha titulo="Modalidade">
        <p className="font-bold">{ROTULO_MODALIDADE[p.modalidade]}</p>
        <p className="ivo-legenda text-texto-suave">Reboque: {ROTULO_REBOQUE[p.reboque]}</p>
      </Linha>
      {(p.contato_nome || p.contato_telefone) && (
        <Linha titulo="Contato no local">
          <p className="font-semibold">{p.contato_nome}</p>
          {p.contato_telefone && (
            <a href={`tel:${p.contato_telefone.replace(/[^\d+]/g, '')}`} className="font-semibold text-link underline">
              {p.contato_telefone}
            </a>
          )}
        </Linha>
      )}
      {p.observacoes && (
        <Linha titulo="Observações">
          <p className="ivo-corpo break-words whitespace-pre-line">{p.observacoes}</p>
        </Linha>
      )}
      {p.solicitante_nome && (
        <Linha titulo="Pedido por">
          <p className="font-semibold">{p.solicitante_nome}</p>
        </Linha>
      )}
    </Cartao>
  )
}

const ROTULO_HISTORICO: Record<string, string> = {
  SOLICITADA: 'Pedido solicitado',
  ORCADA: 'Orçamento enviado',
  AGENDADA: 'Agendado',
  EM_ANDAMENTO: 'Saiu para o serviço',
  CONCLUIDA: 'Concluído',
  RECUSADA: 'Recusado pelo motorista',
  REPROVADA: 'Orçamento reprovado',
  EXPIRADA: 'Expirou',
  CANCELADA: 'Cancelado',
}

/** Detalhe do pedido: andamento, prazos, orçamento recebido (memorial + regras) e ações permitidas agora. */
export function Pedido() {
  const { id = '' } = useParams()
  const { perfil } = useSessao()
  const local = useLocation()
  const avisoInicial = (local.state as { aviso?: unknown } | null)?.aviso
  const [aviso, setAviso] = useState<string | null>(typeof avisoInicial === 'string' ? avisoInicial : null)
  const [acao, setAcao] = useState<Acao | null>(null)
  const [aprovando, setAprovando] = useState(false)
  const [aprovacao, setAprovacao] = useState<Aprovacao | null>(null)
  const [cancelandoAgendado, setCancelandoAgendado] = useState(false)
  // Inexistente ou de outra empresa: o banco devolve NAO_ENCONTRADO (igual) → `null`. Rede: erro com "tentar de novo".
  const { dados, erro, carregando, recarregar } = useConsulta(`pedido-${id}`, () =>
    pedidos.detalhe(id).catch((e: unknown) => {
      if (e instanceof ErroLeitura && (e.codigo === 'NAO_ENCONTRADO' || e.codigo === 'SEM_PERMISSAO')) return null
      throw e
    }),
  )
  useTempoReal(id ? `atividade:${id}` : null, recarregar)

  if (dados === undefined) {
    if (erro) {
      return (
        <main className="mx-auto max-w-3xl p-4 md:p-6">
          <ErroAoCarregar onTentar={recarregar} />
        </main>
      )
    }
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-4 md:p-6" aria-busy={carregando} aria-label="Carregando o pedido">
        <Skeleton className="h-28" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </main>
    )
  }

  if (dados === null) {
    return (
      <main className="mx-auto max-w-3xl p-4 md:p-6">
        <EstadoVazio icone="busca" titulo="Pedido não encontrado">
          Ele não existe ou não está disponível para você.{' '}
          <Link to="/pedidos" className="font-semibold text-link underline">
            Ver pedidos
          </Link>
        </EstadoVazio>
      </main>
    )
  }

  const p = dados.pedido
  const o = dados.orcamento
  const cliente = perfil?.papel === 'CLIENTE'
  const prestador = perfil?.papel === 'MOTORISTA' || perfil?.papel === 'ADM'
  const decide = dados.acoes.aprovar || dados.acoes.pedir_revisao || dados.acoes.reprovar
  const aberto = !p.prazo_vencido && (p.status === 'SOLICITADA' || p.status === 'ORCADA')
  const comValores = o && o.total_cent !== undefined && o.linhas

  return (
    <main>
      <section className="px-4 pt-2 pb-2">
        <div className="mx-auto max-w-3xl space-y-2">
          <Link to="/pedidos" viewTransition className="-ml-2 inline-flex min-h-12 items-center gap-1 rounded-xl px-2 font-semibold text-texto-suave hover:text-texto">
            <Icone nome="setaEsquerda" tamanho={20} />
            Pedidos
          </Link>
          {(prestador || perfil?.papel === 'GESTOR_FROTA') && <p className="ivo-legenda font-semibold text-texto-suave">{p.empresa_nome}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="ivo-h1 tabular-nums">Pedido {numeroPedido(p.numero)}</h1>
            <SelosStatus status={p.status} prazoVencido={p.prazo_vencido} />
          </div>
          {aberto && p.status === 'SOLICITADA' && (
            <p className="flex items-center gap-2 font-semibold text-alerta-texto">
              <Icone nome="relogio" tamanho={18} />
              <Contagem anunciar prazo={p.prazo_orcar_ate} prefixo={prestador ? 'Responder em' : 'Orçamento em até'} />
            </p>
          )}
          {aberto && p.status === 'ORCADA' && o && (
            <p className="flex items-center gap-2 font-semibold text-alerta-texto">
              <Icone nome="relogio" tamanho={18} />
              <Contagem anunciar prazo={o.valido_ate} prefixo="Orçamento válido por mais" />
            </p>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        {aviso && <Mensagem tipo="sucesso">{aviso}</Mensagem>}

        {aprovacao && <CartaoAgendado pedido={p} aprovacao={aprovacao} />}

        <Cartao>
          <LinhaDoTempo status={p.status} historico={dados.historico} />
        </Cartao>

        {dados.acoes.orcar && (
          <Link
            to={`/pedidos/${p.id}/orcar`}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-botao bg-acao px-5 text-lg ivo-botao text-acao-texto"
          >
            Orçar este pedido
          </Link>
        )}

        {o && (
          <Cartao className="space-y-4" data-testid="orcamento-recebido">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-texto-suave">
                  Orçamento{o.versao > 1 ? `, versão ${o.versao}` : ''}
                </p>
                {comValores ? (
                  <Dinheiro centavos={o.total_cent!} className="ivo-valor" />
                ) : (
                  <p className="ivo-h3">{ROTULO_MODALIDADE[o.modalidade]}</p>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-fundo px-3 py-1 ivo-legenda font-semibold">{ROTULO_MODALIDADE[o.modalidade]}</span>
            </div>
            <p className="flex items-center gap-2 ivo-legenda font-semibold text-texto-suave tabular-nums">
              <Icone nome="relogio" tamanho={16} />
              Válido até {formatarDataHora(o.valido_ate)}
            </p>
            {o.horario_sugerido && (
              <Mensagem tipo="info">O motorista sugere outro horário: {formatarQuando(o.horario_sugerido)}.</Mensagem>
            )}
            {comValores && <Memorial linhas={o.linhas!} total={o.total_cent!} />}
            {o.regras && (
              <section aria-label="Regras de cancelamento" className="space-y-1 border-t border-borda pt-3">
                <h2 className="font-bold">Se precisar cancelar depois de aprovado</h2>
                <p className="ivo-legenda text-texto-suave">Multa sobre o valor aprovado, pela antecedência do aviso.</p>
                <FaixasCancelamento faixas={o.regras.faixas_cancelamento} />
              </section>
            )}
            {cliente && decide && (
              <div className="space-y-3 border-t border-borda pt-4">
                {dados.acoes.aprovar && (
                  <Botao variante="principal" className="w-full" onClick={() => setAprovando(true)}>
                    {comValores ? `Aprovar ${formatarCentavos(o.total_cent!)}` : 'Aprovar'}
                  </Botao>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {dados.acoes.pedir_revisao && <Botao onClick={() => setAcao('revisao')}>Pedir revisão</Botao>}
                  {dados.acoes.reprovar && <Botao onClick={() => setAcao('reprovar')}>Reprovar</Botao>}
                </div>
              </div>
            )}
          </Cartao>
        )}

        <Detalhes r={dados} />

        {dados.acoes.cancelar_agendado && (
          <Botao className="w-full !text-[var(--status-cancelada)]" onClick={() => setCancelandoAgendado(true)}>
            Cancelar agendamento
          </Botao>
        )}

        {dados.acoes.cancelar && (
          <Botao className="w-full !text-[var(--status-cancelada)]" onClick={() => setAcao('cancelar')}>
            Cancelar pedido
          </Botao>
        )}

        <Cartao>
          <h2 className="ivo-sobretitulo text-texto-suave">Histórico</h2>
          <ol className="mt-2" data-testid="historico-pedido">
            {[...dados.historico].reverse().map((h, i) => (
              <li key={`${h.em}-${i}`} className="flex gap-3 border-b border-borda py-2.5 last:border-b-0">
                <span className="mt-0.5">
                  <StatusBadgePequeno para={h.para} />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{ROTULO_HISTORICO[h.para] ?? h.para}</p>
                  <p className="ivo-legenda text-texto-suave tabular-nums">
                    {formatarDataHora(h.em)}
                    {h.por_nome ? `, ${h.por_nome}` : ''}
                  </p>
                  {h.observacao && <p className="ivo-corpo break-words">“{h.observacao}”</p>}
                </div>
              </li>
            ))}
          </ol>
        </Cartao>
      </div>

      <FolhaAprovar
        aberta={aprovando}
        pedido={p}
        orcamento={o}
        aoFechar={() => setAprovando(false)}
        aoAprovado={(a) => {
          // Só depois do OK do servidor: fecha o recibo, mostra o check → card "Agendado" e relê o pedido.
          setAprovando(false)
          setAviso(null)
          setAprovacao(a)
          recarregar()
        }}
        aoJaAprovado={() => {
          setAprovando(false)
          setAviso('Este orçamento já tinha sido aprovado.')
          recarregar()
        }}
        aoMudou={recarregar}
      />

      <FolhaCancelarAgendado
        aberta={cancelandoAgendado}
        atividade={p.id}
        numero={p.numero}
        faixas={o?.regras?.faixas_cancelamento}
        aoFechar={() => setCancelandoAgendado(false)}
        aoCancelado={(c) => {
          setCancelandoAgendado(false)
          setAprovacao(null)
          setAviso(avisoCancelamento(c))
          recarregar()
        }}
        aoJaCancelado={() => {
          setCancelandoAgendado(false)
          setAviso('Este agendamento já tinha sido cancelado.')
          recarregar()
        }}
        aoMudou={recarregar}
      />

      <FolhaAcao
        acao={acao}
        id={p.id}
        motivoObrigatorio={prestador}
        aoFechar={() => setAcao(null)}
        aoConcluir={(m) => {
          setAcao(null)
          setAviso(m)
          recarregar()
        }}
      />
    </main>
  )
}

function StatusBadgePequeno({ para }: { para: string }) {
  const negativo = ['RECUSADA', 'REPROVADA', 'EXPIRADA', 'CANCELADA'].includes(para)
  return (
    <span
      aria-hidden="true"
      className={`flex size-6 items-center justify-center rounded-full ${negativo ? 'bg-[var(--status-cancelada)] text-white' : 'bg-marinho-2 text-white'}`}
    >
      <Icone nome={negativo ? 'fechar' : 'check'} tamanho={14} />
    </span>
  )
}
