import { useState } from 'react'
import { Link } from 'react-router'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Mensagem } from '../../design/componentes/Mensagem.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { StatusBadge } from '../../design/componentes/StatusBadge.tsx'
import { CabecalhoTela } from '../../design/componentes/Tela.tsx'
import { useConsulta } from '../../lib/consulta.ts'
import { pedidos, type Bloco } from '../../lib/pedidos.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { faixaHorario, hoje as hojeSp, intervaloDoDia, janelasLivres, mesDe, nomeDoDia, numeroPedido, type Janela } from '../../lib/tempo.ts'
import { useTempoReal } from '../../lib/tempoReal.ts'
import { topicoDoPerfil } from '../../lib/topicos.ts'
import { podeCriarPedido } from '../pedidos/Pedidos.tsx'
import { Calendario } from './Calendario.tsx'

type Item = { tipo: 'bloco'; bloco: Bloco } | { tipo: 'livre'; janela: Janela }

function BlocoAgenda({ b, equipe }: { b: Bloco; equipe: boolean }) {
  const horario = <span className="font-bold tabular-nums">{faixaHorario(b.inicio, b.fim)}</span>
  if (b.atividade_id === undefined) {
    return (
      <div className="flex items-center gap-3 rounded-cartao border-[1.5px] border-borda bg-borda/50 p-3.5 text-texto-suave" data-testid="bloco-ocupado">
        <Icone nome="cadeado" tamanho={20} />
        <div>
          {horario}
          <p className="font-semibold">Ocupado</p>
        </div>
      </div>
    )
  }
  const conteudo = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {horario}
          <p className="font-semibold">
            Pedido {b.numero !== undefined ? numeroPedido(b.numero) : ''}
            {equipe && b.empresa_nome ? ` · ${b.empresa_nome}` : ''}
          </p>
        </div>
        {b.status && <StatusBadge status={b.status} />}
      </div>
      <p className="mt-1 truncate ivo-legenda text-texto-suave">
        {b.origem} → {b.destino}
      </p>
      {b.tipo === 'PRE_RESERVA' && <p className="ivo-legenda text-texto-suave">Pré-reserva até o orçamento ser decidido</p>}
    </>
  )
  const classe = 'block rounded-cartao border-[1.5px] border-l-4 border-borda border-l-marinho-2 bg-superficie p-3.5 shadow-[var(--sombra)]'
  return b.pode_abrir ? (
    <Link to={`/pedidos/${b.atividade_id}`} viewTransition className={`${classe} hover:border-marinho-2`} data-testid="bloco-proprio">
      {conteudo}
    </Link>
  ) : (
    <div className={classe} data-testid="bloco-proprio">
      {conteudo}
    </div>
  )
}

function JanelaLivre({ j, pedir }: { j: Janela; pedir: boolean }) {
  const texto = (
    <>
      <span className="font-bold">Livre</span> · <span className="tabular-nums">{faixaHorario(j.inicio, j.fim)}</span>
    </>
  )
  const classe =
    'flex min-h-12 items-center justify-between gap-2 rounded-cartao border-2 border-dashed border-[var(--status-concluida)] px-3.5 py-2.5 text-[var(--status-concluida)]'
  return pedir ? (
    <Link
      to={`/pedidos/novo?inicio=${encodeURIComponent(j.inicio)}`}
      className={`${classe} hover:bg-[var(--status-concluida)]/10`}
      data-testid="janela-livre"
      aria-label={`Livre das ${faixaHorario(j.inicio, j.fim).replace('–', ' às ')}: fazer pedido neste horário`}
    >
      <span>{texto}</span>
      <span className="flex items-center gap-1 text-sm font-bold">
        Pedir
        <Icone nome="mais" tamanho={18} />
      </span>
    </Link>
  ) : (
    <div className={classe} data-testid="janela-livre">
      <span>{texto}</span>
    </div>
  )
}

/** Agenda (A7): mês com marcadores e o dia selecionado com blocos e janelas livres. Todos os perfis. */
export function Agenda() {
  const { perfil } = useSessao()
  const hoje = hojeSp()
  const [mes, setMes] = useState(() => mesDe(hoje))
  const [dia, setDia] = useState(hoje)
  const equipe = perfil?.papel !== 'CLIENTE'
  const pedir = !!perfil && podeCriarPedido(perfil) && perfil.empresa_tem_contrato !== false

  const calendario = useConsulta(`agenda-mes-${mes}`, () => pedidos.diasDoMes(mes, 60))
  const doDia = useConsulta(`agenda-dia-${dia}`, async () => {
    const { de, ate } = intervaloDoDia(dia)
    const [blocos, livres] = await Promise.all([
      pedidos.agenda(de, ate),
      dia >= hoje ? pedidos.horariosLivres(dia, 30) : Promise.resolve({ horarios: [] as string[], dia_cheio: false }),
    ])
    return { blocos, janelas: janelasLivres(livres.horarios, 30) }
  })
  const recarregar = () => {
    calendario.recarregar()
    doDia.recarregar()
  }
  useTempoReal(topicoDoPerfil(perfil), recarregar)

  const itens: Item[] = doDia.dados
    ? [
        ...doDia.dados.blocos.map((bloco) => ({ tipo: 'bloco' as const, bloco })),
        ...doDia.dados.janelas.map((janela) => ({ tipo: 'livre' as const, janela })),
      ].sort((a, b) => {
        const ia = a.tipo === 'bloco' ? a.bloco.inicio : a.janela.inicio
        const ib = b.tipo === 'bloco' ? b.bloco.inicio : b.janela.inicio
        return new Date(ia).getTime() - new Date(ib).getTime()
      })
    : []

  const erroMes = calendario.erro && calendario.dados === undefined

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo={perfil?.papel === 'CLIENTE' ? (perfil.empresa_nome ?? 'Sua empresa') : 'IVO Transportes'}
        titulo="Agenda"
        descricao={
          equipe
            ? 'Todos os pedidos e pré-reservas da agenda do motorista.'
            : 'Seus pedidos e os horários livres. Horários de outras empresas aparecem só como ocupados.'
        }
      />
      <div className="grid gap-5 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:items-start">
        <Cartao>
          <Calendario
            mes={mes}
            dias={erroMes ? [] : calendario.dados}
            selecionado={dia}
            hoje={hoje}
            modo="agenda"
            grande
            aoSelecionar={setDia}
            aoMudarMes={(m) => {
              setMes(m)
              setDia(m === mesDe(hoje) ? hoje : m)
            }}
          />
          {erroMes && (
            <div className="pt-3">
              <Mensagem tipo="erro">Não foi possível carregar o calendário. Verifique a conexão.</Mensagem>
            </div>
          )}
        </Cartao>

        <section aria-labelledby="titulo-dia" className="space-y-3" data-testid="agenda-dia">
          <h2 id="titulo-dia" className="ivo-h3">
            {nomeDoDia(dia)}
          </h2>
          {doDia.erro && doDia.dados === undefined ? (
            <ErroDia recarregar={doDia.recarregar} />
          ) : doDia.dados === undefined ? (
            <div className="space-y-2" aria-busy="true" aria-label="Carregando o dia">
              <Skeleton className="h-16" />
              <Skeleton className="h-12" />
              <Skeleton className="h-16" />
            </div>
          ) : itens.length === 0 ? (
            <p className="ivo-corpo text-texto-suave">
              {dia < hoje ? 'Nada registrado neste dia.' : 'Nenhum horário livre neste dia.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {itens.map((it) => (
                <li key={it.tipo === 'bloco' ? `b-${it.bloco.inicio}-${it.bloco.atividade_id ?? ''}` : `l-${it.janela.inicio}`}>
                  {it.tipo === 'bloco' ? <BlocoAgenda b={it.bloco} equipe={equipe} /> : <JanelaLivre j={it.janela} pedir={pedir} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}

function ErroDia({ recarregar }: { recarregar: () => void }) {
  return (
    <div className="space-y-2">
      <Mensagem tipo="erro">Não foi possível carregar este dia. Verifique a conexão.</Mensagem>
      <button type="button" onClick={recarregar} className="min-h-12 rounded-xl px-3 font-semibold text-marinho-2 underline">
        Tentar de novo
      </button>
    </div>
  )
}
