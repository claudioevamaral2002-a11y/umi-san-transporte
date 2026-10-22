import { useId, useState } from 'react'
import { Skeleton } from '../../../design/componentes/Skeleton.tsx'
import { ErroAoCarregar, useTituloNaTela } from '../../../design/componentes/Tela.tsx'
import { rotuloStatus, type PedidoPainel } from '../../../lib/painelEmpresa.ts'
import { hoje, mesDe, somarMeses } from '../../../lib/tempo.ts'
import {
  BOTAO_CONTORNO,
  CAMPO_FILTRO,
  CARTAO,
  TabelaCorridas,
  baixarCsv,
  useContextoPainel,
  usePainelDaEmpresa,
} from './componentes.tsx'

const MES_E_ANO = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' })
const MESES_NA_LISTA = 6

/** Meses para escolher: o atual (o banco usa o mês de hoje, `null`) e os 5 anteriores. */
function mesesParaEscolher(): Array<{ valor: string | null; rotulo: string }> {
  const atual = mesDe(hoje())
  return Array.from({ length: MESES_NA_LISTA }, (_, i) => {
    const mes = somarMeses(atual, -i)
    return { valor: i === 0 ? null : mes, rotulo: MES_E_ANO.format(new Date(`${mes}T12:00:00Z`)) }
  })
}

function Filtro({
  rotulo,
  valor,
  onMudar,
  opcoes,
}: {
  rotulo: string
  valor: string
  onMudar: (v: string) => void
  opcoes: Array<{ valor: string; rotulo: string }>
}) {
  const id = useId()
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-texto-suave">
        {rotulo}
      </label>
      <select id={id} value={valor} onChange={(e) => onMudar(e.target.value)} className={CAMPO_FILTRO}>
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Aba "Corridas" (/empresa/corridas): as corridas do mês com cobrança, filtros e CSV. */
export function AbaCorridas() {
  const { ehAdm, semEmpresa, erroEmpresas, recarregarEmpresas } = useContextoPainel()
  useTituloNaTela('oculto')
  const meses = mesesParaEscolher()
  const [indiceMes, setIndiceMes] = useState(0)
  const [status, setStatus] = useState('')
  const [centro, setCentro] = useState('')
  const { dados, erro, recarregar } = usePainelDaEmpresa(meses[indiceMes]?.valor ?? null)

  const corridas: PedidoPainel[] = dados?.do_mes ?? []
  const statusPresentes = [...new Set(corridas.map((p) => p.status))]
  const centrosPresentes = [...new Set(corridas.map((p) => p.centro_custo).filter((c): c is string => !!c))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  )
  // Uma escolha que não existe no mês aberto vale como "Todos".
  const statusAtual = statusPresentes.some((s) => s === status) ? status : ''
  const centroAtual = centrosPresentes.includes(centro) ? centro : ''
  const filtradas = corridas.filter((p) => (!statusAtual || p.status === statusAtual) && (!centroAtual || p.centro_custo === centroAtual))

  return (
    <main className="mx-auto max-w-[1200px] space-y-6 px-4 pt-7 md:px-8">
      <h1 className="sr-only">Corridas</h1>
      <div className={`${CARTAO} grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end`}>
        <Filtro
          rotulo="Mês"
          valor={String(indiceMes)}
          onMudar={(v) => setIndiceMes(Number(v))}
          opcoes={meses.map((m, i) => ({ valor: String(i), rotulo: m.rotulo }))}
        />
        <Filtro
          rotulo="Status"
          valor={statusAtual}
          onMudar={setStatus}
          opcoes={[{ valor: '', rotulo: 'Todos' }, ...statusPresentes.map((s) => ({ valor: s, rotulo: rotuloStatus(s) }))]}
        />
        <Filtro
          rotulo="Centro de custo"
          valor={centroAtual}
          onMudar={setCentro}
          opcoes={[{ valor: '', rotulo: 'Todos' }, ...centrosPresentes.map((c) => ({ valor: c, rotulo: c }))]}
        />
        <button
          type="button"
          disabled={!dados || filtradas.length === 0}
          onClick={() => dados && baixarCsv(filtradas, dados.resumo.mes.slice(0, 7))}
          className={`${BOTAO_CONTORNO} disabled:opacity-50`}
        >
          Exportar CSV
        </button>
      </div>
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
              Carregando as corridas…
            </p>
            <Skeleton className="h-64 rounded-[20px]" />
          </div>
        )
      ) : (
        <>
          <p className="text-sm text-texto-suave">Corridas em andamento, concluídas e canceladas com cobrança.</p>
          <TabelaCorridas
            titulo="Corridas do mês"
            itens={filtradas}
            vazio={corridas.length === 0 ? 'Nenhuma corrida neste mês.' : 'Nenhuma corrida com esses filtros.'}
            ehCliente={!ehAdm}
            comHoras
          />
        </>
      )}
    </main>
  )
}
