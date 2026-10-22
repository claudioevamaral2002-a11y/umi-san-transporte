import { useId, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { SimboloIvo } from '../../../design/componentes/SimboloIvo.tsx'
import { ErroAoCarregar } from '../../../design/componentes/Tela.tsx'
import { formatarCentavos } from '../../../design/dinheiro.ts'
import { api, type Empresa } from '../../../lib/api.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import { csvDoMes, painelEmpresa, rotuloStatus, type Painel, type PedidoPainel } from '../../../lib/painelEmpresa.ts'
import { useSessao } from '../../../lib/sessao.tsx'
import { diaDe, horaDe, hoje, somarDias } from '../../../lib/tempo.ts'
import { diaCurto, reaisCurto } from '../../formatos.ts'

/**
 * "Painel da empresa" (especificação §6.9, mockup 14 no tom executivo da Rhino, Ruling R17): para o Administrador
 * (N1) da própria empresa e para o Master (ADM), que escolhe a empresa no topo. Menu no topo, quase monocromático:
 * hierarquia pelo tamanho e pelo peso, etiquetas de situação pálidas e o laranja só no símbolo. No celular, as tabelas
 * viram cartões. Só leitura; os valores vêm do banco a cada abertura (sem memória: é dinheiro).
 */

const MES = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long' })

/** "outubro" a partir de "2026-10-01". */
function nomeDoMes(mes: string): string {
  return MES.format(new Date(`${mes}T12:00:00Z`))
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

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

function Roteiro({ p }: { p: PedidoPainel }) {
  // A chegada da corrida em andamento é uma previsão.
  const chegada = `${p.status === 'EM_ANDAMENTO' ? '~' : ''}${horaDe(p.fim_previsto)}`
  return (
    <span className="grid grid-cols-[3.25rem_1fr] gap-x-2 gap-y-1">
      <span className="text-texto-suave tabular-nums">{horaDe(p.inicio)}</span>
      <span className="break-words">{p.origem}</span>
      <span className="text-texto-suave tabular-nums">{chegada}</span>
      <span className="break-words">{p.destino}</span>
    </span>
  )
}

const CARTAO = 'rounded-[20px] bg-superficie shadow-[var(--sombra)]'
const BOTAO_CONTORNO =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-borda bg-superficie px-4 text-sm font-semibold text-texto hover:bg-painel-fundo'

/** Corridas: tabela no computador; cartões empilhados no celular (sem rolagem para o lado). */
function TabelaCorridas({
  titulo,
  itens,
  vazio,
  ehCliente,
}: {
  titulo: string
  itens: PedidoPainel[]
  vazio: string
  ehCliente: boolean
}) {
  const navegar = useNavigate()
  if (itens.length === 0) {
    return <p className={`${CARTAO} p-6 ivo-corpo text-texto-suave`}>{vazio}</p>
  }
  return (
    <div className={`${CARTAO} p-2 md:p-3`}>
      <table className="hidden w-full border-collapse text-sm md:table">
        <caption className="sr-only">{titulo}</caption>
        <thead>
          <tr className="text-left text-texto-suave">
            {['Quem pediu', 'Data', 'Roteiro', 'Categoria', 'Centro de custo', 'Status'].map((c, i) => (
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

function Secao({ titulo, link, children }: { titulo: string; link?: { para: string; texto: string }; children: ReactNode }) {
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

/** Só os dígitos, para o link de ligação ("(47) 9 9999-0000" → "tel:+5547999990000"). */
function linkDoContato(contato: string): string | null {
  const d = contato.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  return d.length === 10 || d.length === 11 ? `tel:+55${d}` : null
}

function Resumo({ resumo, extrato }: { resumo: Painel['resumo']; extrato: string }) {
  const { gasto_cent: gasto, total_mes_cent: total } = resumo
  const porcento = total > 0 ? Math.min(100, Math.max(0, Math.round((gasto / total) * 100))) : 0
  const contato = resumo.contato_recarga
  const tel = contato ? linkDoContato(contato) : null
  return (
    <Secao titulo={`Resumo de ${nomeDoMes(resumo.mes)}`} link={{ para: extrato, texto: 'Extrato' }}>
      <div className={`${CARTAO} space-y-5 p-6 md:p-8`} data-testid="resumo-mes">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <p className="text-sm font-medium text-texto-suave">Gasto no mês</p>
            <p className="text-[2.25rem] leading-tight font-extrabold tracking-[-0.03em] tabular-nums md:text-5xl">
              {reaisCurto(gasto)}
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-sm font-medium text-texto-suave">Total do mês</p>
            <p className="text-[2.25rem] leading-tight font-extrabold tracking-[-0.03em] tabular-nums md:text-5xl">
              {reaisCurto(total)}
            </p>
          </div>
        </div>
        <div
          role="meter"
          aria-label="Gasto do total do mês"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={porcento}
          aria-valuetext={`${porcento}% do total do mês`}
        >
          <svg className="block h-3.5 w-full" aria-hidden="true">
            <rect width="100%" height="100%" rx="7" className="fill-painel-trilho" />
            {porcento > 0 && <rect width={`${porcento}%`} height="100%" rx="7" className="fill-painel-barra" />}
          </svg>
          <p className="mt-2 text-xs text-texto-suave">
            {porcento}% do total do mês (saldo no início do mês + recargas + limite de crédito)
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-borda pt-4">
          <p>
            <span className="text-lg font-bold tabular-nums">{reaisCurto(resumo.disponivel_cent)}</span>{' '}
            <span className="font-semibold">disponível</span>
            {resumo.reservado_cent > 0 && (
              <span className="text-sm text-texto-suave">
                {' '}
                · {reaisCurto(resumo.reservado_cent)} reservado em corridas confirmadas
              </span>
            )}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-texto-suave">
            Para recarregar, fale com a IVO
            {contato &&
              (tel ? (
                <a href={tel} className={BOTAO_CONTORNO}>
                  Falar com a IVO · <span className="tabular-nums">{contato}</span>
                </a>
              ) : (
                <span className="font-semibold text-texto">{contato}</span>
              ))}
          </p>
        </div>
      </div>
    </Secao>
  )
}

function Pessoas({ pessoas, equipe, onExportar }: { pessoas: Painel['pessoas']; equipe: string; onExportar: () => void }) {
  const etiqueta = 'rounded-md bg-tag-neutro-fundo px-2 py-0.5 text-sm font-bold text-tag-neutro-texto tabular-nums'
  return (
    <Secao titulo="Pessoas" link={{ para: equipe, texto: 'Equipe' }}>
      <div className={`${CARTAO} flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4`} data-testid="bloco-pessoas">
        <p className="flex items-center gap-2">
          <span className={etiqueta}>{plural(pessoas.sem_corridas, 'pessoa', 'pessoas')}</span>
          <span>{pessoas.sem_corridas === 1 ? 'ainda não fez corridas' : 'ainda não fizeram corridas'}</span>
        </p>
        <p className="flex items-center gap-2">
          <span className={etiqueta}>{plural(pessoas.convites_pendentes, 'convite', 'convites')}</span>
          <span>{pessoas.convites_pendentes === 1 ? 'não aceito' : 'não aceitos'}</span>
        </p>
        <span className="flex flex-wrap gap-2 md:ml-auto">
          {/* O fluxo de convite de hoje (Equipe: "Gerar novo link" ou "Convidar"). */}
          <Link to={equipe} className={BOTAO_CONTORNO}>
            Reenviar convite
          </Link>
          <button type="button" onClick={onExportar} className={BOTAO_CONTORNO}>
            Exportar CSV do mês
          </button>
        </span>
      </div>
    </Secao>
  )
}

function baixarCsv(painel: Painel) {
  // BOM (U+FEFF) para o Excel abrir os acentos certos.
  const blob = new Blob([String.fromCharCode(0xfeff), csvDoMes(painel.do_mes)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `corridas-${painel.resumo.mes.slice(0, 7)}.csv`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const ITEM_MENU = 'flex min-h-11 items-center border-b-2 font-semibold'

/** Menu no topo (sem barra lateral). O ☰ do app novo fica à esquerda, por cima. */
function BarraDoPainel({
  links,
  empresas,
  empresa,
  onEmpresa,
  nomeEmpresa,
}: {
  links: { corridas: string; pessoas: string; carteira: string }
  empresas: Empresa[] | null
  empresa: string | null
  onEmpresa: (id: string) => void
  nomeEmpresa: string | null
}) {
  const idSeletor = useId()
  return (
    // Região própria (o <header> da moldura já é o banner, com o ☰).
    <section aria-label="Topo do painel" className="border-b border-borda bg-superficie">
      <div className="flex flex-wrap items-center gap-x-10 gap-y-1 px-4 py-3 md:pr-8 md:pl-[4.75rem]">
        <span className="flex min-h-12 items-center gap-2 pl-[3.75rem] text-lg font-extrabold md:pl-0 tracking-[-0.02em]">
          <SimboloIvo altura={24} />
          IVO para empresas
        </span>
        <nav aria-label="Painel da empresa" className="order-last w-full md:order-none md:w-auto">
          <ul className="flex gap-5 md:gap-6">
            <li>
              <Link to="/empresa" aria-current="page" className={`${ITEM_MENU} border-texto text-texto`}>
                Painel
              </Link>
            </li>
            {(
              [
                ['Corridas', links.corridas],
                ['Pessoas', links.pessoas],
                ['Carteira', links.carteira],
              ] as const
            ).map(([rotulo, para]) => (
              <li key={rotulo}>
                <Link to={para} className={`${ITEM_MENU} border-transparent text-texto-suave hover:text-texto`}>
                  {rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <span className="ml-auto flex items-center gap-2">
          {empresas ? (
            <>
              <label htmlFor={idSeletor} className="sr-only">
                Empresa
              </label>
              <select
                id={idSeletor}
                value={empresa ?? ''}
                onChange={(e) => onEmpresa(e.target.value)}
                className="min-h-11 rounded-xl border border-borda bg-superficie px-3 font-bold text-texto"
              >
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
              </select>
            </>
          ) : (
            nomeEmpresa && <span className="font-bold">{nomeEmpresa}</span>
          )}
        </span>
      </div>
    </section>
  )
}

export function PainelEmpresa() {
  const { perfil } = useSessao()
  const ehAdm = perfil?.papel === 'ADM'
  const [busca, setBusca] = useSearchParams()
  const listaEmpresas = useConsulta('painel-empresa-empresas', () => (ehAdm ? api.empresas() : Promise.resolve([])))
  const empresa = ehAdm ? (busca.get('empresa') ?? listaEmpresas.dados?.[0]?.id ?? null) : null
  const semEmpresa = ehAdm && listaEmpresas.dados !== undefined && listaEmpresas.dados.length === 0
  const { dados, erro, recarregar } = useConsulta(
    `painel-empresa:${empresa ?? (ehAdm ? '?' : 'minha')}`,
    // O ADM espera a lista de empresas para saber qual abrir.
    () => (ehAdm && !empresa ? new Promise<Painel>(() => {}) : painelEmpresa.ler(empresa)),
  )

  const links = ehAdm
    ? { corridas: '/pedidos', pessoas: '/adm/usuarios', carteira: empresa ? `/adm/creditos/${empresa}` : '/adm/creditos' }
    : { corridas: '/pedidos', pessoas: '/equipe', carteira: '/extrato' }

  return (
    <div className="min-h-dvh bg-painel-fundo pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <BarraDoPainel
        links={links}
        empresas={ehAdm ? (listaEmpresas.dados ?? []) : null}
        empresa={empresa}
        onEmpresa={(id) => setBusca({ empresa: id }, { replace: true })}
        nomeEmpresa={perfil?.empresa_nome ?? null}
      />
      <main className="mx-auto max-w-[1200px] space-y-9 px-4 pt-7 md:px-8">
        <h1 className="sr-only">Painel da empresa</h1>
        {semEmpresa ? (
          <p className={`${CARTAO} p-6`}>Nenhuma empresa cadastrada.</p>
        ) : !dados ? (
          erro || listaEmpresas.erro ? (
            <ErroAoCarregar
              onTentar={() => {
                listaEmpresas.recarregar()
                recarregar()
              }}
            />
          ) : (
            <div className="space-y-6" aria-busy="true">
              <p role="status" className="sr-only">
                Carregando o painel…
              </p>
              <Skeleton className="h-56 rounded-[20px]" />
              <Skeleton className="h-48 rounded-[20px]" />
              <Skeleton className="h-48 rounded-[20px]" />
            </div>
          )
        ) : (
          <>
            <Resumo resumo={dados.resumo} extrato={links.carteira} />
            <Secao titulo="Próximas corridas" link={{ para: '/pedidos', texto: 'Ver todas' }}>
              <TabelaCorridas
                titulo="Próximas corridas"
                itens={dados.proximas}
                vazio="Nenhuma corrida marcada."
                ehCliente={!ehAdm}
              />
            </Secao>
            <Secao titulo="Corridas recentes" link={{ para: '/pedidos', texto: 'Ver todas' }}>
              <TabelaCorridas
                titulo="Corridas recentes"
                itens={dados.recentes}
                vazio="Nenhuma corrida nos últimos 30 dias."
                ehCliente={!ehAdm}
              />
            </Secao>
            <Pessoas pessoas={dados.pessoas} equipe={links.pessoas} onExportar={() => baixarCsv(dados)} />
          </>
        )}
      </main>
    </div>
  )
}
