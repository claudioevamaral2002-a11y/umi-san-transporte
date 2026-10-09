import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Botao } from '../../design/componentes/Botao.tsx'
import { CarregandoPickup } from '../../design/componentes/CarregandoPickup.tsx'
import { Dinheiro } from '../../design/componentes/Dinheiro.tsx'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { formatarCentavos } from '../../design/dinheiro.ts'
import { useConsulta } from '../../lib/consulta.ts'
import { mensagemDoCodigo } from '../../lib/erros.ts'
import type { DetalhePedido, OrcamentoVisto } from '../../lib/pedidos.ts'
import { Intencao, dinheiro, resumoDispositivo, saldoAposAprovacao, semResposta } from '../../lib/saldo.ts'
import { formatarQuando, numeroPedido } from '../../lib/tempo.ts'
import { formatarDataHora } from '../../lib/valores.ts'
import { FaixasCancelamento } from '../contratos/CartoesContrato.tsx'
import { Contagem, Memorial, Rota } from './componentes.tsx'

/** Resultado confirmado pelo servidor (`api.aprovar_orcamento`). */
export interface Aprovacao {
  reservado_cent: number
  disponivel_cent: number
}

type Estado =
  | { fase: 'recibo' }
  | { fase: 'processando' }
  | { fase: 'erro'; codigo: string; detalhe: Record<string, unknown> }

const MUDOU = ['ORCAMENTO_ALTERADO', 'ORCAMENTO_VENCIDO', 'STATUS_INVALIDO', 'HORARIO_OCUPADO']

const TEXTO_MUDOU: Record<string, string> = {
  ORCAMENTO_ALTERADO: 'O orçamento mudou desde que você abriu o recibo. Atualizamos o pedido: confira os novos valores antes de aprovar.',
  ORCAMENTO_VENCIDO: 'A validade deste orçamento venceu e o pedido foi encerrado. Se ainda precisar do serviço, faça um novo pedido.',
  STATUS_INVALIDO: 'Este pedido mudou de situação. Atualizamos a tela para você conferir.',
  HORARIO_OCUPADO: 'O horário deste pedido não está mais livre. Fale com a IVO Transportes ou faça um novo pedido.',
}

function LinhaValor({ rotulo, children, destaque = false }: { rotulo: string; children: ReactNode; destaque?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${destaque ? 'font-bold' : ''}`}>
      <dt className={destaque ? '' : 'text-texto-suave'}>{rotulo}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  )
}

/** Saldo de agora e depois da aprovação — conta só de exibição; quem decide é o banco. */
function SaldoNoRecibo({ total }: { total: number }) {
  const { dados, erro } = useConsulta('saldo-recibo', () => dinheiro.saldo(null))
  if (dados === undefined) {
    return erro ? (
      <p className="ivo-legenda text-texto-suave">Não foi possível ler o saldo agora. O servidor confere ao confirmar.</p>
    ) : (
      <Skeleton className="h-20" />
    )
  }
  const depois = saldoAposAprovacao(dados, total)
  return (
    <section aria-label="Saldo da empresa" className="space-y-2 rounded-xl bg-fundo p-3" data-testid="recibo-saldo">
      <dl className="space-y-1.5">
        <LinhaValor rotulo="Disponível agora">
          <Dinheiro centavos={dados.disponivel_cent} />
        </LinhaValor>
        <LinhaValor rotulo="Reserva deste pedido">
          − <Dinheiro centavos={total} />
        </LinhaValor>
        <LinhaValor rotulo="Disponível depois da aprovação" destaque>
          <span data-testid="recibo-saldo-depois">
            <Dinheiro centavos={depois.disponivel_depois_cent} />
          </span>
        </LinhaValor>
      </dl>
      <p className="ivo-legenda text-texto-suave">Limite de crédito {formatarCentavos(dados.limite_cent)}.</p>
      {!depois.cabe && (
        <p className="ivo-legenda font-semibold text-alerta-texto">
          Pelo saldo de agora, faltariam {formatarCentavos(depois.falta_cent)}. Ao confirmar, o servidor confere o saldo
          atualizado.
        </p>
      )}
    </section>
  )
}

function SaldoInsuficiente({ detalhe }: { detalhe: Record<string, unknown> }) {
  const n = (c: string) => (typeof detalhe[c] === 'number' ? (detalhe[c] as number) : null)
  const falta = n('falta_cent')
  return (
    <div className="space-y-3" data-testid="saldo-insuficiente">
      <Mensagem tipo="erro">
        {falta !== null ? `Faltam ${formatarCentavos(falta)} para aprovar este orçamento.` : mensagemDoCodigo('SALDO_INSUFICIENTE')}
      </Mensagem>
      <dl className="space-y-1.5 rounded-xl bg-fundo p-3">
        {n('disponivel_cent') !== null && (
          <LinhaValor rotulo="Disponível agora">
            <Dinheiro centavos={n('disponivel_cent')!} />
          </LinhaValor>
        )}
        {n('limite_cent') !== null && (
          <LinhaValor rotulo="Limite de crédito">
            <Dinheiro centavos={n('limite_cent')!} />
          </LinhaValor>
        )}
        {n('total_cent') !== null && (
          <LinhaValor rotulo="Total do orçamento">
            <Dinheiro centavos={n('total_cent')!} />
          </LinhaValor>
        )}
      </dl>
      <p className="ivo-corpo">
        Fale com a IVO Transportes para recarregar o saldo da empresa. Depois, é só aprovar de novo enquanto o orçamento
        estiver válido.
      </p>
    </div>
  )
}

/** Animação de processamento: aparece já (texto) e a pickup entra se passar de 400 ms. Nada muda antes da resposta. */
export function Processando({ texto }: { texto: string }) {
  return (
    <div aria-busy="true" className="space-y-2 py-2 text-center" data-testid="processando">
      <div className="mx-auto h-1.5 w-full overflow-hidden rounded-full bg-borda" aria-hidden="true">
        <span className="block h-full w-1/3 animate-pulse rounded-full bg-marinho-2 motion-reduce:animate-none" />
      </div>
      <p className="font-semibold" role="status">
        {texto}
      </p>
      <CarregandoPickup ativo rotulo="Aguardando o servidor…" />
    </div>
  )
}

function ConteudoAprovar({
  pedido,
  orcamento,
  aoAprovado,
  aoJaAprovado,
  aoMudou,
  aoFechar,
}: {
  pedido: DetalhePedido
  orcamento: OrcamentoVisto & { linhas: NonNullable<OrcamentoVisto['linhas']>; total_cent: number; hash: string }
  aoAprovado: (a: Aprovacao) => void
  aoJaAprovado: () => void
  aoMudou: () => void
  aoFechar: () => void
}) {
  const [estado, setEstado] = useState<Estado>({ fase: 'recibo' })
  // Uma chave por intenção de aprovar ESTE orçamento (versão + hash); repetida em "Tentar de novo".
  const [intencao] = useState(() => new Intencao())

  async function confirmar() {
    setEstado({ fase: 'processando' })
    const chave = intencao.chave(`${pedido.id}|${orcamento.versao}|${orcamento.hash}`)
    const r = await dinheiro.aprovar(pedido.id, orcamento.versao, orcamento.hash, chave, resumoDispositivo(navigator.userAgent))
    if (r.ok) {
      intencao.encerrar()
      aoAprovado({ reservado_cent: Number(r.reservado_cent), disponivel_cent: Number(r.disponivel_cent) })
      return
    }
    if (r.codigo === 'JA_PROCESSADO') {
      aoJaAprovado()
      return
    }
    if (r.codigo && MUDOU.includes(r.codigo)) aoMudou()
    setEstado({ fase: 'erro', codigo: r.codigo ?? 'ERRO_INESPERADO', detalhe: r })
  }

  if (estado.fase === 'processando') return <Processando texto="Confirmando a aprovação com o servidor…" />

  if (estado.fase === 'erro') {
    const rede = semResposta({ ok: false, codigo: estado.codigo })
    return (
      <div className="space-y-4" data-testid="aprovar-erro">
        {estado.codigo === 'SALDO_INSUFICIENTE' ? (
          <SaldoInsuficiente detalhe={estado.detalhe} />
        ) : rede ? (
          <Mensagem tipo="erro">
            Não conseguimos confirmar com o servidor. Verifique a internet e toque em “Tentar de novo” — a aprovação não
            será feita duas vezes.
          </Mensagem>
        ) : (
          <Mensagem tipo="erro">{TEXTO_MUDOU[estado.codigo] ?? mensagemDoCodigo(estado.codigo)}</Mensagem>
        )}
        {rede ? (
          <Botao variante="principal" className="w-full" onClick={() => void confirmar()}>
            Tentar de novo
          </Botao>
        ) : (
          <Botao className="w-full" onClick={aoFechar}>
            {MUDOU.includes(estado.codigo) ? 'Ver pedido atualizado' : 'Fechar'}
          </Botao>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="recibo-aprovacao">
      <div className="space-y-2 rounded-xl border border-borda p-3">
        <p className="font-bold tabular-nums">{formatarQuando(pedido.inicio)}</p>
        <Rota origem={pedido.origem} destino={pedido.destino} compacta />
      </div>
      <Memorial linhas={orcamento.linhas} total={orcamento.total_cent} />
      <p className="flex flex-wrap items-center gap-x-2 ivo-legenda font-semibold text-texto-suave tabular-nums">
        <Icone nome="relogio" tamanho={16} />
        Válido até {formatarDataHora(orcamento.valido_ate)}
        <span>·</span>
        <Contagem prazo={orcamento.valido_ate} prefixo="faltam" vencido="Validade vencida" />
      </p>
      {orcamento.regras && (
        <section aria-label="Regras de cancelamento" className="space-y-1">
          <h3 className="font-bold">Se precisar cancelar depois de aprovado</h3>
          <FaixasCancelamento faixas={orcamento.regras.faixas_cancelamento} />
        </section>
      )}
      <SaldoNoRecibo total={orcamento.total_cent} />
      <p className="ivo-legenda text-texto-suave">
        Ao confirmar, o total fica reservado no saldo da empresa e o horário fica garantido. A cobrança acontece na saída
        do serviço.
      </p>
      <Botao variante="principal" className="w-full" onClick={() => void confirmar()}>
        Confirmar aprovação
      </Botao>
    </div>
  )
}

/** Recibo da aprovação (especificação 4.3 e 12.2): memorial, validade, regras e saldo; resultado só do servidor. */
export function FolhaAprovar({
  aberta,
  pedido,
  orcamento,
  aoFechar,
  aoAprovado,
  aoJaAprovado,
  aoMudou,
}: {
  aberta: boolean
  pedido: DetalhePedido
  orcamento: OrcamentoVisto | null
  aoFechar: () => void
  aoAprovado: (a: Aprovacao) => void
  aoJaAprovado: () => void
  aoMudou: () => void
}) {
  const completo =
    orcamento && orcamento.linhas && orcamento.total_cent !== undefined && orcamento.hash
      ? { ...orcamento, linhas: orcamento.linhas, total_cent: orcamento.total_cent, hash: orcamento.hash }
      : null
  return (
    <Folha aberta={aberta} titulo="Recibo da aprovação" sobretitulo={`Pedido ${numeroPedido(pedido.numero)}`} onFechar={aoFechar}>
      {completo ? (
        <ConteudoAprovar
          pedido={pedido}
          orcamento={completo}
          aoAprovado={aoAprovado}
          aoJaAprovado={aoJaAprovado}
          aoMudou={aoMudou}
          aoFechar={aoFechar}
        />
      ) : (
        <Mensagem tipo="erro">{mensagemDoCodigo('ORCAMENTO_ALTERADO')}</Mensagem>
      )}
    </Folha>
  )
}

const prefereReduzido = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Depois do OK do servidor: o check animado vira o card "Agendado" (com movimento reduzido, o card direto). */
export function CartaoAgendado({ pedido, aprovacao }: { pedido: DetalhePedido; aprovacao: Aprovacao }) {
  const [fase, setFase] = useState<'check' | 'saindo' | 'card'>(() => (prefereReduzido() ? 'card' : 'check'))
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (fase === 'card') {
      titulo.current?.focus()
      return
    }
    const t = setTimeout(() => setFase(fase === 'check' ? 'saindo' : 'card'), fase === 'check' ? 900 : 260)
    return () => clearTimeout(t)
  }, [fase])

  if (fase !== 'card') {
    return (
      <div className="flex flex-col items-center gap-2 py-4" data-testid="aprovacao-check" role="status">
        <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true" className={fase === 'saindo' ? 'check-sair' : ''}>
          <circle cx="48" cy="48" r="44" fill="var(--status-concluida)" className="check-circulo motion-reduce:animate-none" />
          <path
            d="M28 50l13 13 27-29"
            fill="none"
            stroke="#fff"
            strokeWidth="8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="check-traco motion-reduce:animate-none"
          />
        </svg>
        <p className="font-bold">Aprovado</p>
      </div>
    )
  }

  return (
    <section
      className="agendado-entrar space-y-3 rounded-cartao border-[1.5px] border-[var(--status-agendada)] bg-superficie p-4 shadow-[var(--sombra)] motion-reduce:animate-none"
      data-testid="cartao-agendado"
      aria-labelledby="titulo-agendado"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--status-agendada)] text-white">
          <Icone nome="check" />
        </span>
        <div className="min-w-0">
          <p className="ivo-sobretitulo text-texto-suave">Pedido {numeroPedido(pedido.numero)}</p>
          <h2 id="titulo-agendado" ref={titulo} tabIndex={-1} className="ivo-h3 outline-none">
            Agendado
          </h2>
        </div>
      </div>
      <p className="font-semibold tabular-nums">{formatarQuando(pedido.inicio)}</p>
      <dl className="space-y-1.5 border-t border-borda pt-3">
        <LinhaValor rotulo="Reservado no saldo">
          <span data-testid="agendado-reservado">
            <Dinheiro centavos={aprovacao.reservado_cent} />
          </span>
        </LinhaValor>
        <LinhaValor rotulo="Disponível agora" destaque>
          <span data-testid="agendado-disponivel">
            <Dinheiro centavos={aprovacao.disponivel_cent} />
          </span>
        </LinhaValor>
      </dl>
    </section>
  )
}
