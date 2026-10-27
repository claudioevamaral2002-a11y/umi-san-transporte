import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { CampoSelecao } from '../../design/componentes/Campo.tsx'
import { Dinheiro } from '../../design/componentes/Dinheiro.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { useConsulta } from '../../lib/consulta.ts'
import { ROTULO_PRESET, diaBr, periodoDe, type Preset } from '../../lib/extrato.ts'
import { pedidos } from '../../lib/pedidos.ts'
import { dinheiro, ordenarPorRisco, type Divergencia, type Painel as DadosPainel } from '../../lib/saldo.ts'
import { rotuloDivergencia } from '../../lib/saldoExibicao.ts'
import { horaDe, numeroPedido } from '../../lib/tempo.ts'
import { useTempoReal } from '../../lib/tempoReal.ts'
import { formatarDataHora } from '../../lib/valores.ts'
import { SeloAlerta } from './Creditos.tsx'

const PRESETS: Exclude<Preset, 'personalizado'>[] = ['mes', '7d', '30d', 'mes_anterior']

function Numero({ rotulo, valor, testid }: { rotulo: string; valor: ReactNode; testid?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-fundo p-3">
      <p className="ivo-legenda text-texto-suave">{rotulo}</p>
      <p className="ivo-h2 tabular-nums" data-testid={testid}>
        {valor}
      </p>
    </div>
  )
}

function Bloco({ titulo, children, testid, acao }: { titulo: string; children: ReactNode; testid: string; acao?: ReactNode }) {
  return (
    <Cartao className="space-y-3" data-testid={testid}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="ivo-sobretitulo text-texto-suave">{titulo}</h2>
        {acao}
      </div>
      {children}
    </Cartao>
  )
}

function ListaCredito({ dados, limite }: { dados: DadosPainel; limite?: number }) {
  const empresas = ordenarPorRisco(dados.empresas)
  const mostradas = limite ? empresas.slice(0, limite) : empresas
  if (empresas.length === 0) return <p className="ivo-corpo text-texto-suave">Nenhuma empresa cadastrada.</p>
  return (
    <ul className="divide-y divide-borda" data-testid="painel-lista-credito">
      {mostradas.map((e) => (
        <li key={e.empresa_id}>
          <Link to={`/adm/creditos/${e.empresa_id}`} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:text-link">
            <span className="min-w-0">
              <span className="block truncate font-bold">{e.empresa_nome}</span>
              <span className="block ivo-legenda text-texto-suave tabular-nums">
                Reservado <Dinheiro centavos={e.reservado_cent} />, limite <Dinheiro centavos={e.limite_cent} />
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <Dinheiro centavos={e.disponivel_cent} className="font-bold" />
              {e.abaixo_alerta && <SeloAlerta />}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Reconciliacao({ dados }: { dados: DadosPainel }) {
  const r = dados.ultima_reconciliacao
  const nomes = new Map(dados.empresas.map((e) => [e.empresa_id, e.empresa_nome]))
  if (!r) return <p className="ivo-corpo text-texto-suave">Ainda não houve reconciliação (roda todo dia às 03:00).</p>
  return (
    <div className="space-y-2" data-testid="painel-reconciliacao-estado">
      <p className="flex items-center gap-2 font-bold">
        <span
          aria-hidden="true"
          className={`flex size-7 items-center justify-center rounded-full text-white ${r.ok ? 'bg-[var(--status-concluida)]' : 'bg-[var(--status-cancelada)]'}`}
        >
          <Icone nome={r.ok ? 'check' : 'alerta'} tamanho={16} />
        </span>
        {r.ok ? 'Tudo confere' : `${r.divergencias_qtd} divergência${r.divergencias_qtd === 1 ? '' : 's'}`}
      </p>
      <p className="ivo-legenda text-texto-suave tabular-nums">
        {formatarDataHora(r.em)}, {r.empresas} empresa{r.empresas === 1 ? '' : 's'} conferida{r.empresas === 1 ? '' : 's'}
      </p>
      {!r.ok && (
        <ul className="space-y-1.5" data-testid="lista-divergencias">
          {r.divergencias.map((d: Divergencia, i) => (
            <li key={i} className="rounded-xl border border-[var(--status-cancelada)] px-3 py-2">
              <p className="font-semibold">{rotuloDivergencia(d.tipo)}</p>
              <p className="ivo-legenda text-texto-suave">
                {d.empresa_id ? (nomes.get(d.empresa_id) ?? 'Empresa') : 'Empresa'}
                {d.atividade_id && (
                  <>
                    {', '}
                    <Link to={`/pedidos/${d.atividade_id}`} className="font-semibold text-link underline">
                      ver pedido
                    </Link>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Fase 3B: viagens em andamento agora, com a previsão e o atalho para o mapa (o ADM vê todas). */
function CorridasEmAndamento() {
  const { dados, recarregar } = useConsulta('painel-corridas-andamento', pedidos.pendencias)
  useTempoReal('equipe', recarregar)
  const corridas = (dados?.proximos ?? []).filter((p) => p.status === 'EM_ANDAMENTO')
  if (corridas.length === 0) return null
  return (
    <ul className="divide-y divide-borda" data-testid="lista-corridas-andamento">
      {corridas.map((c) => (
        <li key={c.id}>
          <Link to={`/pedidos/${c.id}`} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:text-link">
            <span className="min-w-0">
              <span className="block truncate font-bold">
                Pedido {numeroPedido(c.numero)}
                {c.empresa_nome ? `, ${c.empresa_nome}` : ''}
              </span>
              <span className="block truncate ivo-legenda text-texto-suave">
                {c.destino}
                {c.fim_previsto ? `, término previsto ${horaDe(c.fim_previsto)}` : ''}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {c.atrasado && (
                <span className="rounded-full bg-[var(--cor-laranja)]/15 px-2.5 py-0.5 text-xs font-bold text-alerta-texto">Atrasado</span>
              )}
              <Icone nome="mapa" tamanho={18} className="text-texto-suave" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Blocos({ dados, resumo = false }: { dados: DadosPainel; resumo?: boolean }) {
  return (
    <div className={`grid gap-4 ${resumo ? '' : 'md:grid-cols-2'}`}>
      <Bloco
        titulo="Crédito por cliente"
        testid="painel-credito"
        acao={
          <Link to="/adm/creditos" className="min-h-10 font-semibold text-link underline-offset-4 hover:underline">
            Ver todos
          </Link>
        }
      >
        <ListaCredito dados={dados} limite={resumo ? 3 : undefined} />
      </Bloco>
      <div className="grid gap-4">
        <Bloco titulo="Corridas" testid="painel-corridas">
          <div className="grid grid-cols-2 gap-3">
            <Numero rotulo="Agendadas" valor={dados.corridas.agendadas} testid="painel-agendadas" />
            <Numero rotulo="Em andamento" valor={dados.corridas.em_andamento} testid="painel-em-andamento" />
          </div>
          {dados.corridas.em_andamento > 0 && <CorridasEmAndamento />}
        </Bloco>
        {!resumo && (
          <Bloco titulo="Aprovado no período" testid="painel-aprovado">
            <Numero
              rotulo={`${dados.aprovado.quantidade} pedido${dados.aprovado.quantidade === 1 ? '' : 's'} aprovado${dados.aprovado.quantidade === 1 ? '' : 's'}`}
              valor={<Dinheiro centavos={dados.aprovado.total_cent} />}
              testid="painel-aprovado-total"
            />
            <p className="ivo-legenda text-texto-suave">O realizado é debitado na saída de cada serviço e aparece no extrato do cliente.</p>
          </Bloco>
        )}
        <Bloco titulo="Pendências" testid="painel-pendencias">
          <div className="grid grid-cols-3 gap-2">
            <Numero rotulo="Aguardando orçamento" valor={dados.pendencias.aguardando_orcamento} />
            <Numero rotulo="Aguardando aprovação" valor={dados.pendencias.aguardando_aprovacao} />
            <Numero rotulo="Abaixo do alerta" valor={dados.pendencias.empresas_abaixo_alerta} testid="painel-abaixo-alerta" />
          </div>
        </Bloco>
      </div>
      <div className={resumo ? '' : 'md:col-span-2'}>
        <Bloco titulo="Última reconciliação" testid="painel-reconciliacao">
          <Reconciliacao dados={dados} />
        </Bloco>
      </div>
    </div>
  )
}

/**
 * /adm/painel — crédito por cliente, corridas, aprovado no período, pendências e reconciliação. v2.1: o app novo passa
 * em `extra` as pendências das faturas (a v1 não passa nada e fica como antes).
 */
export function Painel({ extra }: { extra?: ReactNode } = {}) {
  const [preset, setPreset] = useState<Exclude<Preset, 'personalizado'>>('mes')
  const [agora] = useState(() => new Date())
  const periodo = useMemo(() => periodoDe(preset, agora), [preset, agora])
  const { dados, erro, recarregar } = useConsulta(`painel-${preset}`, () =>
    dinheiro.painel(periodo?.de ?? null, periodo ? new Date(Math.min(periodo.ate.getTime(), Date.now())) : null),
  )
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo="Administração"
        titulo="Painel"
        acao={
          <CampoSelecao rotulo="Período" value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)} className="md:w-56">
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PRESET[p]}
              </option>
            ))}
          </CampoSelecao>
        }
        descricao={periodo ? `De ${diaBr(periodo.diaDe)} a ${diaBr(periodo.diaAte)}` : undefined}
      />
      {extra}
      {dados === undefined ? (
        erro ? (
          <ErroAoCarregar onTentar={recarregar} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Carregando o painel">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        )
      ) : (
        <Blocos dados={dados} />
      )}
    </main>
  )
}

/** Resumo do painel no Início do ADM. */
export function PainelResumo() {
  const { dados } = useConsulta('painel-resumo', () => dinheiro.painel(null, null))
  return <ResumoDoPainel dados={dados} />
}

/** v2.2: o resumo a partir do painel já lido (o Início do Master lê uma vez para as pendências e para o resumo). */
export function ResumoDoPainel({ dados }: { dados: DadosPainel | undefined }) {
  if (!dados) return null
  return (
    <section aria-labelledby="titulo-painel-resumo" className="space-y-2" data-testid="painel-resumo">
      <div className="flex items-center justify-between px-1">
        <h2 id="titulo-painel-resumo" className="ivo-sobretitulo text-texto-suave">
          Painel
        </h2>
        <Link to="/adm/painel" viewTransition className="inline-flex min-h-12 items-center gap-1 font-semibold text-link">
          Abrir painel
        </Link>
      </div>
      <Blocos dados={dados} resumo />
    </section>
  )
}
