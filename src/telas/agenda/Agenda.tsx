import { useState } from 'react'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Segmentado } from '../../design/componentes/Segmentado.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { StatusBadge } from '../../design/componentes/StatusBadge.tsx'
import { useConsulta } from '../../lib/consulta.ts'
import { tipoDoBloco, type EntradaGrade } from '../../lib/gradeAgenda.ts'
import { pedidos, type Bloco } from '../../lib/pedidos.ts'
import { useSessao } from '../../lib/sessao.tsx'
import {
  faixaHorario,
  hoje as hojeSp,
  intervaloDoDia,
  janelasLivres,
  mesDe,
  nomeDoDia,
  nomeDoMes,
  numeroPedido,
  somarDias,
} from '../../lib/tempo.ts'
import { useTempoReal } from '../../lib/tempoReal.ts'
import { topicoDoPerfil } from '../../lib/topicos.ts'
import { podeCriarPedido, usePedidoIndisponivel } from '../pedidos/Pedidos.tsx'
import { Rota } from '../pedidos/componentes.tsx'
import { Calendario } from './Calendario.tsx'
import { domingoDe, FaixaSemana } from './FaixaSemana.tsx'
import { GradeHoras } from './GradeHoras.tsx'

type Visao = 'dia' | 'tres' | 'mes'
const VISOES: ReadonlyArray<{ valor: Visao; rotulo: string }> = [
  { valor: 'dia', rotulo: 'Dia' },
  { valor: 'tres', rotulo: '3 dias' },
  { valor: 'mes', rotulo: 'Mês' },
]
const CHAVE_VISAO = 'agenda-visao'

function visaoGuardada(): Visao {
  try {
    const v = localStorage.getItem(CHAVE_VISAO)
    return v === 'tres' || v === 'mes' ? v : 'dia'
  } catch {
    return 'dia'
  }
}

function guardarVisao(v: Visao) {
  try {
    localStorage.setItem(CHAVE_VISAO, v)
  } catch {
    // Sem armazenamento (aba privada): a visão só não é lembrada.
  }
}

/** Blocos e janelas livres de cada dia, já no formato da grade de horas. */
async function carregarDias(dias: string[], hoje: string, cliente: boolean) {
  const porDia = await Promise.all(
    dias.map(async (dia) => {
      const { de, ate } = intervaloDoDia(dia)
      const [blocos, livres] = await Promise.all([
        pedidos.agenda(de, ate),
        dia >= hoje ? pedidos.horariosLivres(dia, 30) : Promise.resolve({ horarios: [] as string[], dia_cheio: false }),
      ])
      const itens: EntradaGrade[] = [
        ...blocos.map((bloco, i) => ({
          chave: `b-${bloco.inicio}-${bloco.atividade_id ?? i}`,
          tipo: tipoDoBloco(bloco, cliente),
          inicio: bloco.inicio,
          fim: bloco.fim,
          bloco,
        })),
        ...janelasLivres(livres.horarios, 30).map((janela) => ({
          chave: `l-${janela.inicio}`,
          tipo: 'livre' as const,
          inicio: janela.inicio,
          fim: janela.fim,
          janela,
        })),
      ]
      return [dia, { blocos, itens }] as const
    }),
  )
  return Object.fromEntries(porDia)
}

/** Agenda estilo Lark (A7 + redesign): Dia, 3 dias e Mês; todos os perfis. */
export function Agenda() {
  const { perfil } = useSessao()
  const hoje = hojeSp()
  const [visao, setVisao] = useState<Visao>(visaoGuardada)
  const [dia, setDia] = useState(hoje)
  const [mes, setMes] = useState(() => mesDe(hoje))
  const equipe = perfil?.papel !== 'CLIENTE'
  // Janela livre vira atalho de pedido só para quem pode pedir agora (com contrato e com crédito).
  const indisponivel = usePedidoIndisponivel(perfil)
  const pedir = !!perfil && podeCriarPedido(perfil) && !indisponivel

  const dias = visao === 'tres' ? [dia, somarDias(dia, 1), somarDias(dia, 2)] : [dia]
  // A faixa fica presa à semana de hoje (esta e a próxima); só muda de âncora se o dia escolhido sair dela.
  const domingoHoje = domingoDe(hoje)
  const domingo = dia >= domingoHoje && dia <= somarDias(domingoHoje, 13) ? domingoHoje : domingoDe(dia)
  const mesesDaFaixa = [...new Set([mesDe(domingo), mesDe(somarDias(domingo, 13))])]
  const faixa = useConsulta(
    `agenda-faixa-${domingo}`,
    async () => (await Promise.all(mesesDaFaixa.map((m) => pedidos.diasDoMes(m, 60)))).flat(),
    { manterAnterior: true, cache: true },
  )
  const calendario = useConsulta(
    `agenda-mes-${mes}-${visao === 'mes'}`,
    () => (visao === 'mes' ? pedidos.diasDoMes(mes, 60) : Promise.resolve(undefined)),
    { manterAnterior: true, cache: true },
  )
  const doDia = useConsulta(`agenda-dias-${dias.join(',')}-${equipe}`, () => carregarDias(dias, hoje, !equipe), {
    manterAnterior: true,
    cache: true,
  })
  const recarregar = () => {
    faixa.recarregar()
    calendario.recarregar()
    doDia.recarregar()
  }
  useTempoReal(topicoDoPerfil(perfil), recarregar)

  const mudarVisao = (v: Visao) => {
    setVisao(v)
    guardarVisao(v)
    if (v === 'mes') setMes(mesDe(dia))
  }
  const irParaHoje = () => {
    setDia(hoje)
    setMes(mesDe(hoje))
  }
  const mesMostrado = visao === 'mes' ? mes : mesDe(dia)
  const itensPorDia = doDia.dados ? Object.fromEntries(Object.entries(doDia.dados).map(([d, v]) => [d, v.itens])) : {}

  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4 md:p-6">
      <h1 className="sr-only">Agenda</h1>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => mudarVisao('mes')}
          aria-label={`${nomeDoMes(mesMostrado)}: ver o mês`}
          className="flex min-h-11 items-center gap-1 ivo-h2"
        >
          {nomeDoMes(mesMostrado).split(' de ')[0]}
          <Icone nome="setaBaixo" tamanho={20} />
        </button>
        <button
          type="button"
          onClick={irParaHoje}
          className="min-h-10 rounded-full border-[1.5px] border-borda bg-superficie px-4 text-sm font-semibold"
        >
          Hoje
        </button>
      </div>
      {perfil && podeCriarPedido(perfil) && indisponivel && (
        <p className="ivo-legenda text-texto-suave" data-testid="agenda-pedido-indisponivel">
          {indisponivel}
        </p>
      )}
      <Segmentado rotulo="Visualização" opcoes={VISOES} valor={visao} aoMudar={mudarVisao} />

      {visao === 'mes' ? (
        <>
          <Calendario
            mes={mes}
            dias={calendario.erro && calendario.dados === undefined ? [] : calendario.dados}
            selecionado={dia}
            hoje={hoje}
            modo="agenda"
            aoSelecionar={setDia}
            aoMudarMes={(m) => {
              setMes(m)
              setDia(m === mesDe(hoje) ? hoje : m)
            }}
          />
          {calendario.erro && calendario.dados === undefined && (
            <Mensagem tipo="erro">Não foi possível carregar o calendário. Verifique a conexão.</Mensagem>
          )}
          <ResumoDoDia
            dia={dia}
            blocos={doDia.dados?.[dia]?.blocos}
            erro={!!doDia.erro && doDia.dados === undefined}
            recarregar={doDia.recarregar}
            abrir={() => mudarVisao('dia')}
          />
        </>
      ) : (
        <>
          <FaixaSemana inicio={domingo} selecionado={dia} hoje={hoje} dias={faixa.dados} aoSelecionar={setDia} />
          <section
            aria-label={nomeDoDia(dia)}
            data-testid="agenda-dia"
            aria-busy={doDia.atualizando || undefined}
            className={`transition-opacity duration-150 motion-reduce:transition-none ${doDia.atualizando ? 'opacity-60' : ''}`}
          >
            {doDia.erro && doDia.dados === undefined ? (
              <ErroDia recarregar={doDia.recarregar} />
            ) : doDia.dados === undefined ? (
              <div className="space-y-2 pt-3" aria-busy="true" aria-label="Carregando o dia">
                <Skeleton className="h-24" />
                <Skeleton className="h-14" />
                <Skeleton className="h-24" />
              </div>
            ) : (
              <GradeHoras dias={dias} itensPorDia={itensPorDia} hoje={hoje} pedir={pedir} equipe={equipe} />
            )}
          </section>
        </>
      )}
    </main>
  )
}

function ResumoDoDia({
  dia,
  blocos,
  erro,
  recarregar,
  abrir,
}: {
  dia: string
  blocos: Bloco[] | undefined
  erro: boolean
  recarregar: () => void
  abrir: () => void
}) {
  const proprios = (blocos ?? []).filter((b) => b.atividade_id !== undefined)
  const ocupados = (blocos ?? []).length - proprios.length
  return (
    <section data-testid="resumo-dia" aria-labelledby="titulo-resumo" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="titulo-resumo" className="font-semibold">
          {nomeDoDia(dia)}
        </h2>
        <button type="button" onClick={abrir} className="min-h-11 text-sm font-semibold underline underline-offset-4">
          Abrir o dia
        </button>
      </div>
      {erro ? (
        <ErroDia recarregar={recarregar} />
      ) : blocos === undefined ? (
        <Skeleton className="h-20" />
      ) : proprios.length === 0 ? (
        <p className="ivo-corpo text-texto-suave">
          {ocupados > 0 ? 'Nenhum pedido seu neste dia. Há horários ocupados.' : 'Nenhum pedido neste dia.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {proprios.map((b) => (
            <li key={`${b.inicio}-${b.atividade_id}`} className="space-y-2 rounded-cartao bg-superficie p-3.5 shadow-[var(--sombra)]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold tabular-nums">
                  Pedido {b.numero !== undefined ? numeroPedido(b.numero) : ''}, {faixaHorario(b.inicio, b.fim)}
                </span>
                {b.status && <StatusBadge status={b.status} />}
              </div>
              {b.origem && b.destino && <Rota origem={b.origem} destino={b.destino} compacta />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ErroDia({ recarregar }: { recarregar: () => void }) {
  return (
    <div className="space-y-2 pt-3">
      <Mensagem tipo="erro">Não foi possível carregar este dia. Verifique a conexão.</Mensagem>
      <button type="button" onClick={recarregar} className="min-h-12 rounded-xl px-3 font-semibold text-link underline">
        Tentar de novo
      </button>
    </div>
  )
}
