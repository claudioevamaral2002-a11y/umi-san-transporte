import { useId, type ReactNode } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router'
import { RotaDePara } from '../../../design/componentes/RotaDePara.tsx'
import { formatarCentavos } from '../../../design/dinheiro.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { csvDoMes, painelEmpresa, rotuloStatus, type Painel, type PedidoPainel } from '../../../lib/painelEmpresa.ts'
import { diaDe, horaDe, hoje, somarDias } from '../../../lib/tempo.ts'
import { diaCurto } from '../../formatos.ts'

/** O que o painel (cabeçalho com as abas) passa para a aba aberta. */
export interface ContextoPainel {
  ehAdm: boolean
  /** Master: a empresa escolhida no topo (nula enquanto a lista carrega). O Administrador não escolhe: o banco usa a dele. */
  empresa: string | null
  semEmpresa: boolean
  /** Nome da empresa em exibição (a do Master escolhida no topo ou a própria). */
  nomeEmpresa: string
  erroEmpresas: boolean
  recarregarEmpresas: () => void
}

export const useContextoPainel = () => useOutletContext<ContextoPainel>()

/**
 * Leitura do painel da empresa para o mês (`null` = mês atual). O Master espera a lista de empresas para saber qual
 * abrir. Sem memória: é dinheiro, os valores vêm do banco a cada abertura.
 */
export function usePainelDaEmpresa(mes: string | null = null) {
  const { ehAdm, empresa } = useContextoPainel()
  return useConsulta(
    `painel-empresa:${empresa ?? (ehAdm ? '?' : 'minha')}:${mes ?? 'atual'}`,
    () => (ehAdm && !empresa ? new Promise<Painel>(() => {}) : painelEmpresa.ler(empresa, mes)),
  )
}

export const CARTAO = 'rounded-[20px] bg-superficie shadow-[var(--sombra)]'
export const BOTAO_CONTORNO =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-borda bg-superficie px-4 text-sm font-semibold text-texto hover:bg-painel-fundo'
export const CAMPO_FILTRO = 'min-h-11 w-full rounded-xl border border-borda bg-superficie px-3 font-semibold text-texto'

const MES = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long' })

/** "outubro" a partir de "2026-10-01". */
export function nomeDoMesPainel(mes: string): string {
  return MES.format(new Date(`${mes}T12:00:00Z`))
}

export const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** "hoje", "amanhã", "ontem" ou "qua 22/10" (São Paulo). */
function dataCurta(inicio: string): string {
  const dia = diaDe(inicio)
  const h = hoje()
  if (dia === h) return 'hoje'
  if (dia === somarDias(h, 1)) return 'amanhã'
  if (dia === somarDias(h, -1)) return 'ontem'
  return diaCurto(inicio)
}

/** "IVO Passageiros" → "Passageiros" (a marca já está no topo). */
const categoria = (nome: string | null) => (nome ? nome.replace(/^IVO\s+/, '') : '—')

/** "2,5 h" (horas estimadas do pedido). */
const horas = (h: number | null | undefined) => (h == null ? '—' : `${String(h).replace('.', ',')} h`)

/** Para onde vai o toque numa corrida: a em andamento do cliente abre o acompanhamento no mapa. */
function destinoDa(p: PedidoPainel, ehCliente: boolean): string {
  return ehCliente && p.status === 'EM_ANDAMENTO' ? `/corrida/${p.id}` : `/pedidos/${p.id}`
}

const TOM_DA_ETIQUETA: Record<PedidoPainel['status'], string> = {
  SOLICITADA: 'bg-tag-neutro-fundo text-tag-neutro-texto',
  ORCADA: 'bg-tag-neutro-fundo text-tag-neutro-texto',
  AGENDADA: 'bg-tag-neutro-fundo text-tag-neutro-texto',
  EXPIRADA: 'bg-tag-neutro-fundo text-tag-neutro-texto',
  EM_ANDAMENTO: 'bg-tag-azul-fundo text-tag-azul-texto',
  CONCLUIDA: 'bg-tag-verde-fundo text-tag-verde-texto',
  CANCELADA: 'bg-tag-vermelho-fundo text-tag-vermelho-texto',
  RECUSADA: 'bg-tag-vermelho-fundo text-tag-vermelho-texto',
  REPROVADA: 'bg-tag-vermelho-fundo text-tag-vermelho-texto',
}

function Etiqueta({ status }: { status: PedidoPainel['status'] }) {
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${TOM_DA_ETIQUETA[status]}`}>
      {rotuloStatus(status)}
    </span>
  )
}

function Valor({ p }: { p: PedidoPainel }) {
  if (p.valor_cent === null) {
    return p.estimado ? <span className="text-texto-suave">a orçar</span> : <span className="text-texto-suave">—</span>
  }
  return (
    <span className="tabular-nums">
      {formatarCentavos(p.valor_cent)}
      {p.status === 'CANCELADA' && <span className="ml-1 text-xs text-texto-suave">multa</span>}
    </span>
  )
}

/** Horário de saída e chegada, e o percurso em "De → Paradas → Para". */
function Roteiro({ p }: { p: PedidoPainel }) {
  // A chegada da corrida em andamento é uma previsão.
  const chegada = `${p.status === 'EM_ANDAMENTO' ? '~' : ''}${horaDe(p.fim_previsto)}`
  return (
    <span className="block space-y-1">
      <span className="block text-texto-suave tabular-nums">
        {horaDe(p.inicio)} <span aria-hidden="true">→</span>
        <span className="sr-only"> até </span> {chegada}
      </span>
      <RotaDePara origem={p.origem} destino={p.destino} paradas={p.paradas ?? []} />
    </span>
  )
}

/** Corridas: tabela no computador; cartões empilhados no celular (sem rolagem para o lado). */
export function TabelaCorridas({
  titulo,
  itens,
  vazio,
  ehCliente,
  comHoras = false,
}: {
  titulo: string
  itens: PedidoPainel[]
  vazio: string
  ehCliente: boolean
  comHoras?: boolean
}) {
  const navegar = useNavigate()
  if (itens.length === 0) {
    return <p className={`${CARTAO} p-6 ivo-corpo text-texto-suave`}>{vazio}</p>
  }
  const colunas = ['Quem pediu', 'Data', 'Roteiro', 'Categoria', ...(comHoras ? ['Horas'] : []), 'Centro de custo', 'Status']
  return (
    <div className={`${CARTAO} p-2 md:p-3`}>
      <table className="hidden w-full border-collapse text-sm md:table">
        <caption className="sr-only">{titulo}</caption>
        <thead>
          <tr className="text-left text-texto-suave">
            {colunas.map((c, i) => (
              <th key={c} scope="col" className={`bg-painel-fundo px-3 py-2.5 font-semibold ${i === 0 ? 'rounded-l-xl' : ''}`}>
                {c}
              </th>
            ))}
            <th scope="col" className="rounded-r-xl bg-painel-fundo px-3 py-2.5 text-right font-semibold">
              Valor
            </th>
          </tr>
        </thead>
        <tbody>
          {itens.map((p) => (
            <tr
              key={p.id}
              onClick={() => void navegar(destinoDa(p, ehCliente))}
              className="cursor-pointer border-b border-borda align-top last:border-b-0 hover:bg-painel-fundo/60"
            >
              <td className="px-3 py-3.5 font-semibold">
                <Link
                  to={destinoDa(p, ehCliente)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Corrida #${String(p.numero).padStart(4, '0')} de ${p.solicitante_nome ?? 'pessoa removida'}, ${rotuloStatus(p.status)}`}
                  className="hover:underline"
                >
                  {p.solicitante_nome ?? '—'}
                </Link>
              </td>
              <td className="px-3 py-3.5 whitespace-nowrap">{dataCurta(p.inicio)}</td>
              <td className="px-3 py-3.5">
                <Roteiro p={p} />
              </td>
              <td className="px-3 py-3.5">{categoria(p.categoria_nome)}</td>
              {comHoras && <td className="px-3 py-3.5 whitespace-nowrap tabular-nums">{horas(p.horas_estimadas)}</td>}
              <td className="px-3 py-3.5">{p.centro_custo ?? '—'}</td>
              <td className="px-3 py-3.5">
                <Etiqueta status={p.status} />
              </td>
              <td className="px-3 py-3.5 text-right whitespace-nowrap">
                <Valor p={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul aria-label={titulo} className="divide-y divide-borda md:hidden">
        {itens.map((p) => (
          <li key={p.id}>
            <Link to={destinoDa(p, ehCliente)} className="block space-y-2 rounded-xl px-3 py-3.5 text-sm" data-testid="cartao-corrida">
              <span className="flex items-start justify-between gap-3">
                <span className="font-semibold">{p.solicitante_nome ?? '—'}</span>
                <Etiqueta status={p.status} />
              </span>
              <span className="block text-texto-suave">{dataCurta(p.inicio)}</span>
              <Roteiro p={p} />
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-texto-suave">
                  {categoria(p.categoria_nome)}
                  {comHoras && p.horas_estimadas != null && ` · ${horas(p.horas_estimadas)}`}
                  {p.centro_custo && ` · ${p.centro_custo}`}
                </span>
                <span className="font-semibold whitespace-nowrap">
                  <Valor p={p} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Secao({
  titulo,
  link,
  children,
}: {
  titulo: string
  link?: { para: string; texto: string }
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={id} className="text-xl font-bold tracking-[-0.02em] md:text-2xl">
          {titulo}
        </h2>
        {link && (
          <Link to={link.para} className="text-sm font-semibold text-texto-suave hover:text-texto">
            {link.texto} <span aria-hidden="true">›</span>
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

/** Baixa o CSV das corridas dadas (BOM para o Excel abrir os acentos certos). `mes` = "2026-10". */
export function baixarCsv(itens: readonly PedidoPainel[], mes: string) {
  const blob = new Blob([String.fromCharCode(0xfeff), csvDoMes(itens)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `corridas-${mes}.csv`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Endereço de cada aba; o Master leva a empresa escolhida junto (`?empresa=`). */
export function enderecoDaAba(aba: '' | '/corridas' | '/pessoas' | '/carteira', ehAdm: boolean, empresa: string | null): string {
  return `/empresa${aba}${ehAdm && empresa ? `?empresa=${empresa}` : ''}`
}
