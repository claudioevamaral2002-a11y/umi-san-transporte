import { useContext, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Botao } from '../../design/componentes/Botao.tsx'
import { Campo, CampoSelecao } from '../../design/componentes/Campo.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, ContextoTituloPagina, EstadoVazio, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { formatarCentavos } from '../../design/dinheiro.ts'
import { useConsulta } from '../../lib/consulta.ts'
import {
  ESTORNAVEIS,
  ROTULO_PRESET,
  ROTULO_TIPO,
  diaBr,
  efeitoDisponivel,
  formatarComSinal,
  montarCsv,
  natureza,
  nomeArquivo,
  periodoDe,
  type Periodo,
  type Preset,
} from '../../lib/extrato.ts'
import { TIPOS_LANCAMENTO, dinheiro, type ItemExtrato, type Saldo, type TipoLancamento } from '../../lib/saldo.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { hoje, numeroPedido } from '../../lib/tempo.ts'
import { useTempoReal } from '../../lib/tempoReal.ts'
import { topicoSaldo } from '../../lib/topicos.ts'
import { formatarDataHora } from '../../lib/valores.ts'
import { CartaoSaldo, SaldoDaEmpresa, useSaldo } from '../saldo/CartaoSaldo.tsx'
import { ContatoRecarga } from '../saldo/ContatoIvo.tsx'

const LIMITE = 500
const PRESETS: Preset[] = ['mes', '7d', '30d', 'mes_anterior', 'personalizado']

function baixar(nome: string, conteudo: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** PDF: impressão do navegador ("Salvar como PDF"); o título vira o nome sugerido do arquivo. */
function imprimir(nome: string) {
  const anterior = document.title
  document.title = nome
  const restaurar = () => {
    document.title = anterior
    window.removeEventListener('afterprint', restaurar)
  }
  window.addEventListener('afterprint', restaurar)
  window.print()
}

const corDoValor = (centavos: number) =>
  centavos > 0 ? 'text-[var(--status-concluida)]' : centavos < 0 ? 'text-texto' : 'text-texto-suave'

function NumeroPedido({ item }: { item: ItemExtrato }) {
  if (item.numero === null) return <span className="text-texto-suave">—</span>
  // Detalhe só para quem pode ver o pedido (privacidade do extrato, especificação 2); os demais veem o número.
  return item.pode_abrir && item.atividade_id ? (
    <Link to={`/pedidos/${item.atividade_id}`} className="font-semibold text-link underline underline-offset-2">
      Pedido {numeroPedido(item.numero)}
    </Link>
  ) : (
    <span>Pedido {numeroPedido(item.numero)}</span>
  )
}

function Valor({ item }: { item: ItemExtrato }) {
  const e = efeitoDisponivel(item)
  return (
    <span className="flex flex-col items-end">
      <span className={`font-bold tabular-nums ${corDoValor(e)}`}>{formatarComSinal(e)}</span>
      <span className="ivo-legenda text-texto-suave">{natureza(item)}</span>
    </span>
  )
}

function DetalhesAdm({ item }: { item: ItemExtrato }) {
  if (item.motivo === undefined) return null
  return (
    <p className="ivo-legenda break-words text-texto-suave">
      {item.motivo && <>Motivo: {item.motivo}</>}
      {item.comprovante && <>, Comprovante: {item.comprovante}</>}
      {item.criado_por_nome && <>, Por {item.criado_por_nome}</>}
    </p>
  )
}

export interface PropsExtrato {
  /** ADM: a empresa; cliente: `null` (o banco usa a própria). */
  empresa: string | null
  /** Para o tópico de tempo real (`saldo:<id>`). */
  empresaIdTopico: string | null
  empresaNome: string
  adm?: boolean
  /** ADM: abre a folha de estorno. */
  aoEstornar?: (item: ItemExtrato) => void
  /** Muda para forçar a releitura (depois de uma ação do ADM). */
  versao?: number
}

/** Extrato da empresa: filtros (período, tipo), lista no celular / tabela no desktop, CSV e PDF. */
export function ExtratoEmpresa({ empresa, empresaIdTopico, empresaNome, adm = false, aoEstornar, versao = 0 }: PropsExtrato) {
  const [preset, setPreset] = useState<Preset>('mes')
  const [datas, setDatas] = useState(() => ({ de: hoje(), ate: hoje() }))
  const [tipo, setTipo] = useState<TipoLancamento | ''>('')
  // O "agora" fica fixo enquanto a tela está aberta (o período não muda sozinho).
  const [agora] = useState(() => new Date())
  const periodo = useMemo(() => periodoDe(preset, agora, datas), [preset, agora, datas])

  const chave = periodo ? `extrato-${empresa ?? 'propria'}-${periodo.de.toISOString()}-${periodo.ate.toISOString()}-${tipo}-${versao}` : 'extrato-invalido'
  const { dados, erro, carregando, recarregar } = useConsulta(chave, async () =>
    periodo
      ? dinheiro.extrato(empresa, {
          de: periodo.de.toISOString(),
          ate: periodo.ate.toISOString(),
          ...(tipo ? { tipos: [tipo] } : {}),
          limite: LIMITE,
        })
      : [],
  )
  useTempoReal(topicoSaldo(empresaIdTopico), recarregar, 'saldo')

  const estornados = useMemo(() => new Set((dados ?? []).map((i) => i.estorna_id).filter((x) => x !== null)), [dados])
  const podeEstornar = (i: ItemExtrato) => adm && aoEstornar && ESTORNAVEIS.includes(i.tipo) && !estornados.has(i.id)
  const arquivo = periodo ? nomeArquivo(empresaNome, periodo) : 'extrato'

  return (
    <section aria-label="Extrato" className="space-y-4" data-testid="extrato">
      <Cartao className="nao-imprimir space-y-3" data-testid="filtros-extrato">
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoSelecao rotulo="Período" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PRESET[p]}
              </option>
            ))}
          </CampoSelecao>
          <CampoSelecao rotulo="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoLancamento | '')}>
            <option value="">Todos os tipos</option>
            {TIPOS_LANCAMENTO.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO[t]}
              </option>
            ))}
          </CampoSelecao>
        </div>
        {preset === 'personalizado' && (
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="De" type="date" value={datas.de} max={datas.ate} onChange={(e) => setDatas((d) => ({ ...d, de: e.target.value }))} />
            <Campo rotulo="Até" type="date" value={datas.ate} min={datas.de} onChange={(e) => setDatas((d) => ({ ...d, ate: e.target.value }))} />
          </div>
        )}
        {!periodo && <p className="ivo-legenda font-semibold text-[var(--status-cancelada)]">Escolha um período válido (a data inicial antes da final).</p>}
        <div className="flex flex-wrap gap-2">
          <Botao
            disabled={!dados || !periodo}
            onClick={() => baixar(`${arquivo}.csv`, montarCsv(dados ?? [], { adm }), 'text/csv;charset=utf-8')}
          >
            <span className="inline-flex items-center gap-2">
              <Icone nome="tabela" tamanho={18} />
              Exportar CSV
            </span>
          </Botao>
          <Botao disabled={!dados || !periodo} onClick={() => imprimir(arquivo)}>
            <span className="inline-flex items-center gap-2">
              <Icone nome="lista" tamanho={18} />
              Exportar PDF
            </span>
          </Botao>
        </div>
      </Cartao>

      {periodo && <CabecalhoImpressao empresa={empresaNome} periodo={periodo} tipo={tipo} />}

      {dados === undefined ? (
        erro ? (
          <ErroAoCarregar onTentar={recarregar} />
        ) : (
          <div className="space-y-2" aria-busy="true" aria-label="Carregando o extrato">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        )
      ) : dados.length === 0 ? (
        <EstadoVazio icone="lista" titulo="Nenhum lançamento no período">
          Troque o período ou o tipo para ver outros lançamentos.
        </EstadoVazio>
      ) : (
        <div aria-busy={carregando}>
          {dados.length >= LIMITE && (
            <p className="mb-2 ivo-legenda text-texto-suave">
              Mostrando os {LIMITE} lançamentos mais recentes do período. Escolha um período menor para ver todos.
            </p>
          )}
          <ul className="space-y-2 md:hidden print:hidden" data-testid="lista-extrato">
            {dados.map((i) => (
              <li key={i.id} className="space-y-1.5 rounded-cartao border-[1.5px] border-borda bg-superficie p-3.5" data-testid="item-extrato">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">{ROTULO_TIPO[i.tipo] ?? i.tipo}</p>
                    <p className="ivo-legenda text-texto-suave tabular-nums">{formatarDataHora(i.criado_em)}</p>
                  </div>
                  <Valor item={i} />
                </div>
                {(i.numero !== null || i.solicitante_nome) && (
                  <p className="ivo-legenda">
                    <NumeroPedido item={i} />
                    {i.solicitante_nome && <span className="text-texto-suave">, {i.solicitante_nome}</span>}
                  </p>
                )}
                <DetalhesAdm item={i} />
                {podeEstornar(i) && (
                  <button
                    type="button"
                    onClick={() => aoEstornar!(i)}
                    className="min-h-12 font-semibold text-[var(--status-cancelada)] underline underline-offset-2"
                  >
                    Estornar
                  </button>
                )}
              </li>
            ))}
          </ul>
          <TabelaExtrato itens={dados} adm={adm} podeEstornar={podeEstornar} aoEstornar={aoEstornar} />
        </div>
      )}
    </section>
  )
}

function Th({ children, direita = false }: { children: ReactNode; direita?: boolean }) {
  return <th className={`border-b border-borda px-3 py-2 ivo-sobretitulo text-texto-suave ${direita ? 'text-right' : 'text-left'}`}>{children}</th>
}

function TabelaExtrato({
  itens,
  adm,
  podeEstornar,
  aoEstornar,
}: {
  itens: ItemExtrato[]
  adm: boolean
  podeEstornar: (i: ItemExtrato) => boolean | undefined
  aoEstornar?: (i: ItemExtrato) => void
}) {
  return (
    <div className="hidden overflow-x-auto rounded-cartao border-[1.5px] border-borda bg-superficie md:block print:block print:border-0">
      <table className="w-full border-collapse text-sm" data-testid="tabela-extrato">
        <thead>
          <tr>
            <Th>Data</Th>
            <Th>Tipo</Th>
            <Th>Pedido</Th>
            <Th>Solicitante</Th>
            {adm && <Th>Motivo / comprovante / autor</Th>}
            <Th direita>Valor</Th>
            {adm && <th className="nao-imprimir border-b border-borda px-3 py-2"><span className="sr-only">Ações</span></th>}
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.id} className="border-b border-borda last:border-b-0 print:break-inside-avoid">
              <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{formatarDataHora(i.criado_em)}</td>
              <td className="px-3 py-2.5 font-semibold">{ROTULO_TIPO[i.tipo] ?? i.tipo}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <NumeroPedido item={i} />
              </td>
              <td className="px-3 py-2.5">{i.solicitante_nome ?? '—'}</td>
              {adm && (
                <td className="max-w-xs px-3 py-2.5 break-words text-texto-suave">
                  {[i.motivo, i.comprovante && `Comprovante: ${i.comprovante}`, i.criado_por_nome && `Por ${i.criado_por_nome}`]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </td>
              )}
              <td className="px-3 py-2.5 text-right">
                <Valor item={i} />
              </td>
              {adm && (
                <td className="nao-imprimir px-3 py-2.5 text-right">
                  {podeEstornar(i) && (
                    <button
                      type="button"
                      onClick={() => aoEstornar!(i)}
                      aria-label={`Estornar ${ROTULO_TIPO[i.tipo]} de ${formatarDataHora(i.criado_em)}`}
                      className="min-h-10 rounded-lg px-2 font-semibold text-[var(--status-cancelada)] underline underline-offset-2"
                    >
                      Estornar
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Só no papel: empresa, período, filtro e data de emissão. */
function CabecalhoImpressao({ empresa, periodo, tipo }: { empresa: string; periodo: Periodo; tipo: TipoLancamento | '' }) {
  return (
    <div className="hidden space-y-1 print:block" data-testid="cabecalho-impressao">
      <p className="text-xl font-bold">IVO Transportes — Extrato de {empresa}</p>
      <p>
        Período: {diaBr(periodo.diaDe)} a {diaBr(periodo.diaAte)}
        {tipo ? `, Tipo: ${ROTULO_TIPO[tipo]}` : ''}
      </p>
      <p>Emitido em {formatarDataHora(new Date())}</p>
    </div>
  )
}

/**
 * v2.1 (§5.3): no Faturado não há saldo a recarregar. O saldo contábil (≤ 0) é o que a empresa deve, faturado e a
 * faturar: o "Total devido". (O "Em aberto" do painel é outra conta: só as faturas emitidas e não pagas.)
 */
function TotalDevido({ saldo }: { saldo: Saldo }) {
  const aFavor = saldo.saldo_contabil_cent > 0
  return (
    <Cartao className="space-y-1" data-testid="total-devido">
      <p className="ivo-legenda font-semibold text-texto-suave">{aFavor ? 'Saldo a favor' : 'Total devido'}</p>
      <p className="ivo-valor tabular-nums">{formatarCentavos(Math.abs(saldo.saldo_contabil_cent))}</p>
      {!aFavor && <p className="ivo-legenda text-texto-suave">faturado e a faturar</p>}
    </Cartao>
  )
}

/**
 * /extrato do app novo (v2.1): igual ao de hoje no Crédito; no Faturado (NF), o título vira "Lançamentos" e o cartão de
 * saldo dá lugar ao "Total devido". A forma vem do próprio saldo da empresa (uma leitura só); até ela chegar, o título
 * espera (nada de "Extrato" que vira "Lançamentos").
 */
function ExtratoPelaForma() {
  const { perfil } = useSessao()
  const nome = perfil?.empresa_nome ?? 'Empresa'
  const saldo = useSaldo(perfil?.empresa_id ?? null)
  const faturado = saldo.dados?.forma_cobranca === 'FATURADO'
  // No app novo o h1 usa o nome do item do ☰ ("Carteira da empresa"); no Faturado, "Lançamentos".
  const pagina = useContext(ContextoTituloPagina)
  const contexto = useMemo(() => (pagina && faturado ? { ...pagina, titulo: 'Lançamentos' } : pagina), [pagina, faturado])
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div className="nao-imprimir">
        {saldo.dados === undefined && !saldo.erro ? (
          <div aria-hidden="true" className="space-y-2" data-testid="titulo-carregando">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-64" />
          </div>
        ) : (
          <ContextoTituloPagina value={contexto}>
            <CabecalhoTela
              sobretitulo={nome}
              titulo={faturado ? 'Lançamentos' : 'Extrato'}
              descricao={
                faturado ? 'Reservas, cobranças e pagamentos de faturas da empresa.' : 'Recargas, reservas, liberações e cobranças da empresa.'
              }
            />
          </ContextoTituloPagina>
        )}
      </div>
      <div className="nao-imprimir">
        {saldo.dados ? (
          faturado ? (
            <TotalDevido saldo={saldo.dados} />
          ) : (
            // v2.2: no Crédito, o contato da IVO para recarregar.
            <div className="space-y-3">
              <CartaoSaldo saldo={saldo.dados} />
              <ContatoRecarga />
            </div>
          )
        ) : saldo.erro ? (
          <Cartao className="space-y-2" role="alert">
            <p className="font-bold">Não foi possível carregar o saldo.</p>
            <button type="button" onClick={saldo.recarregar} className="min-h-12 font-semibold text-link underline">
              Tentar de novo
            </button>
          </Cartao>
        ) : (
          <Skeleton className="h-52" />
        )}
      </div>
      <ExtratoEmpresa empresa={null} empresaIdTopico={perfil?.empresa_id ?? null} empresaNome={nome} />
    </main>
  )
}

/**
 * /extrato — clientes da empresa (todos os níveis): saldo + extrato. `pelaFormaDeCobranca` (só o app novo, v2.1): no
 * Faturado, "Lançamentos" e o "Total devido" no lugar do saldo. Sem ela (a v1), nada muda.
 */
export function Extrato({ pelaFormaDeCobranca = false }: { pelaFormaDeCobranca?: boolean } = {}) {
  return pelaFormaDeCobranca ? <ExtratoPelaForma /> : <ExtratoDeHoje />
}

function ExtratoDeHoje() {
  const { perfil } = useSessao()
  const nome = perfil?.empresa_nome ?? 'Empresa'
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
      <div className="nao-imprimir">
        <CabecalhoTela sobretitulo={nome} titulo="Extrato" descricao="Recargas, reservas, liberações e cobranças da empresa." />
      </div>
      <div className="nao-imprimir">
        <SaldoDaEmpresa empresa={perfil?.empresa_id ?? null} />
      </div>
      <ExtratoEmpresa empresa={null} empresaIdTopico={perfil?.empresa_id ?? null} empresaNome={nome} />
    </main>
  )
}
