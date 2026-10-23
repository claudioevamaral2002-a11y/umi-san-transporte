import { useState } from 'react'
import { Navigate } from 'react-router'
import { RotaDePara } from '../../../design/componentes/RotaDePara.tsx'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { ErroAoCarregar, useTituloNaTela } from '../../../design/componentes/Tela.tsx'
import { formatarCentavos } from '../../../design/dinheiro.ts'
import { useConsulta } from '../../../lib/consulta.ts'
import {
  ROTULO_SITUACAO,
  csvDaFatura,
  faturas,
  linkNota,
  rotuloQuinzena,
  type Fatura,
  type ItemFatura,
  type ResumoFaturas,
  type SituacaoFatura,
} from '../../../lib/faturas.ts'
import { BOTAO_CONTORNO, CARTAO, Secao, baixarArquivoCsv, enderecoDaAba, useContextoPainel } from './componentes.tsx'

/**
 * Aba "Faturas" (/empresa/faturas, v2.1 §5.3): na empresa Faturado (NF), substitui a Carteira. Em cima, o "A faturar"
 * (o que ainda não entrou numa fatura, com as corridas); embaixo, as faturas da empresa com a NF, o vencimento e a
 * etiqueta (Aberta, Vencida, Paga, Cancelada). A NF abre por um link assinado pedido na hora (vale 60 s); o CSV da
 * fatura sai com as colunas do CSV do mês. O N1 vê a própria empresa; o Master, a escolhida no topo. No Crédito, volta
 * para a Carteira. Tom executivo e quase monocromático, como o resto do painel (Ruling R17).
 */

/** "2026-11-15" → "15/11/2026". */
const dataBr = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`

const DIA_MES = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
})

/** O mesmo tom pálido das etiquetas de status do painel. */
const TOM_DA_SITUACAO: Record<SituacaoFatura, string> = {
  ABERTA: 'bg-tag-neutro-fundo text-tag-neutro-texto',
  VENCIDA: 'bg-tag-vermelho-fundo text-tag-vermelho-texto',
  PAGA: 'bg-tag-verde-fundo text-tag-verde-texto',
  CANCELADA: 'bg-tag-neutro-fundo text-tag-neutro-texto',
}

function EtiquetaFatura({ situacao }: { situacao: SituacaoFatura }) {
  return (
    <span
      data-testid="etiqueta-fatura"
      className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${TOM_DA_SITUACAO[situacao]}`}
    >
      {ROTULO_SITUACAO[situacao]}
    </span>
  )
}

/** "IVO Passageiros" → "Passageiros" (a marca já está no topo). */
const categoria = (nome: string | null) => (nome ? nome.replace(/^IVO\s+/, '') : null)

/** Uma corrida (ou multa, ajuste, estorno) do "A faturar". O valor cobrado é `-valor_cent`. */
function LinhaItem({ item }: { item: ItemFatura }) {
  const detalhes = [categoria(item.categoria_nome), item.centro_custo].filter(Boolean).join(' · ')
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-3.5 text-sm">
      <span className="min-w-0 flex-1 space-y-1">
        <span className="block font-semibold">
          {item.solicitante_nome ?? '—'}
          <span className="font-normal text-texto-suave tabular-nums"> · {DIA_MES.format(new Date(item.criado_em))}</span>
          {item.numero !== null && (
            <span className="font-normal text-texto-suave tabular-nums"> · #{String(item.numero).padStart(4, '0')}</span>
          )}
        </span>
        {item.origem && item.destino && <RotaDePara origem={item.origem} destino={item.destino} paradas={item.paradas ?? []} />}
        {detalhes && <span className="block text-texto-suave">{detalhes}</span>}
      </span>
      <span className="font-semibold whitespace-nowrap tabular-nums">{formatarCentavos(-item.valor_cent)}</span>
    </li>
  )
}

function AFaturar({ resumo }: { resumo: ResumoFaturas['a_faturar'] }) {
  return (
    <Secao titulo="A faturar">
      <div className={`${CARTAO} p-6 md:p-8`} data-testid="cartao-a-faturar">
        <p className="text-sm font-medium text-texto-suave">Ainda sem fatura (quinzena atual e o que ficou de antes)</p>
        <p className="text-[2.25rem] leading-tight font-extrabold tracking-[-0.03em] tabular-nums md:text-5xl">
          {formatarCentavos(resumo.total_cent)}
        </p>
        {resumo.itens.length === 0 ? (
          <p className="mt-4 border-t border-borda pt-4 text-texto-suave">Nenhuma corrida a faturar.</p>
        ) : (
          <ul aria-label="Corridas a faturar" className="mt-4 divide-y divide-borda border-t border-borda">
            {resumo.itens.map((i) => (
              <LinhaItem key={i.lancamento_id} item={i} />
            ))}
          </ul>
        )}
      </div>
    </Secao>
  )
}

function LinhaFatura({ fatura }: { fatura: Fatura }) {
  const [ocupado, setOcupado] = useState<'nf' | 'csv' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const nome = `fatura nº ${fatura.numero}`

  // O link assinado vale 60 s: pedido a cada toque, nunca guardado.
  async function abrirNf(caminho: string) {
    setErro(null)
    setOcupado('nf')
    try {
      const link = await linkNota(caminho)
      const a = document.createElement('a')
      a.href = link
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.append(a)
      a.click()
      a.remove()
    } catch {
      setErro('Não foi possível abrir a NF. Tente de novo.')
    } finally {
      setOcupado(null)
    }
  }

  async function baixarCsv() {
    setErro(null)
    setOcupado('csv')
    try {
      const { fatura: f, itens } = await faturas.ler(fatura.id)
      baixarArquivoCsv(`fatura-${fatura.numero}.csv`, csvDaFatura(f, itens))
    } catch {
      setErro('Não foi possível gerar o CSV. Tente de novo.')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <li className="space-y-3 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-bold">Fatura nº {fatura.numero}</span>
            <EtiquetaFatura situacao={fatura.situacao} />
          </p>
          <p className="text-sm text-texto-suave tabular-nums">
            {rotuloQuinzena(fatura)}
            {fatura.nf_numero && ` · NF ${fatura.nf_numero}`}
          </p>
          <p className="text-sm text-texto-suave tabular-nums">
            {fatura.situacao === 'PAGA' && fatura.paga_em
              ? `Paga em ${dataBr(fatura.paga_em)}`
              : fatura.vencimento && fatura.situacao === 'VENCIDA'
                ? `Venceu em ${dataBr(fatura.vencimento)}`
                : fatura.vencimento && fatura.situacao === 'ABERTA'
                  ? `Vence em ${dataBr(fatura.vencimento)}`
                  : fatura.vencimento
                    ? `Vencimento ${dataBr(fatura.vencimento)}`
                    : null}
          </p>
        </div>
        <p
          className={`text-xl font-extrabold tracking-[-0.02em] tabular-nums ${fatura.situacao === 'CANCELADA' ? 'text-texto-suave line-through' : ''}`}
        >
          {formatarCentavos(fatura.total_cent)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {fatura.nf_pdf_caminho && (
          <button
            type="button"
            className={BOTAO_CONTORNO}
            disabled={ocupado !== null}
            aria-label={`Baixar NF (PDF) da ${nome}`}
            onClick={() => void abrirNf(fatura.nf_pdf_caminho!)}
          >
            {ocupado === 'nf' ? 'Abrindo…' : 'Baixar NF (PDF)'}
          </button>
        )}
        <button
          type="button"
          className={BOTAO_CONTORNO}
          disabled={ocupado !== null}
          aria-label={`CSV da ${nome}`}
          onClick={() => void baixarCsv()}
        >
          {ocupado === 'csv' ? 'Gerando…' : 'CSV da fatura'}
        </button>
      </div>
      {erro && (
        <p role="alert" className="text-sm font-semibold text-[var(--status-cancelada)]">
          {erro}
        </p>
      )}
    </li>
  )
}

function ListaFaturas({ lista }: { lista: Fatura[] }) {
  return (
    <Secao titulo="Faturas">
      {lista.length === 0 ? (
        <p className={`${CARTAO} p-6 ivo-corpo text-texto-suave`}>Nenhuma fatura ainda.</p>
      ) : (
        <ul aria-label="Faturas" className={`${CARTAO} divide-y divide-borda`}>
          {lista.map((f) => (
            <LinhaFatura key={f.id} fatura={f} />
          ))}
        </ul>
      )}
    </Secao>
  )
}

export function AbaFaturas() {
  const { ehAdm, empresa, semEmpresa, forma, erroEmpresas, recarregarEmpresas } = useContextoPainel()
  useTituloNaTela('oculto')
  const pronto = forma === 'FATURADO' && (!ehAdm || !!empresa)
  // Sem memória: é dinheiro. No Crédito (ou antes de saber a forma) não lê nada.
  const { dados, erro, recarregar } = useConsulta(pronto ? `faturas:${empresa ?? 'minha'}` : 'faturas:aguardando', () =>
    pronto ? faturas.listar(ehAdm ? empresa : null) : new Promise<ResumoFaturas>(() => {}),
  )
  if (forma && forma !== 'FATURADO') return <Navigate to={enderecoDaAba('/carteira', ehAdm, empresa)} replace />

  return (
    <main className="mx-auto max-w-5xl space-y-9 p-4 md:p-6">
      <h1 className="sr-only">Faturas</h1>
      {semEmpresa ? (
        <p className={`${CARTAO} p-6`}>Nenhuma empresa cadastrada.</p>
      ) : !dados ? (
        erro || erroEmpresas ? (
          <ErroAoCarregar
            onTentar={() => {
              recarregarEmpresas()
              recarregar()
            }}
          />
        ) : (
          <div className="space-y-6" aria-busy="true">
            <p role="status" className="sr-only">
              Carregando as faturas…
            </p>
            <Skeleton className="h-56 rounded-[20px]" />
            <Skeleton className="h-48 rounded-[20px]" />
          </div>
        )
      ) : (
        <>
          <AFaturar resumo={dados.a_faturar} />
          <ListaFaturas lista={dados.faturas} />
        </>
      )}
    </main>
  )
}
