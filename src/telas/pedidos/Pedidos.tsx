import { Link, useSearchParams } from 'react-router'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, EstadoVazio, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { useConsulta } from '../../lib/consulta.ts'
import { MENSAGENS } from '../../lib/erros.ts'
import type { Perfil } from '../../lib/estadoSessao.ts'
import { pedidos } from '../../lib/pedidos.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { FILTROS, type Filtro } from '../../lib/situacao.ts'
import { useTempoReal } from '../../lib/tempoReal.ts'
import { topicoDoPerfil } from '../../lib/topicos.ts'
import { CartaoPedido } from './componentes.tsx'

/** Cliente N1/N2 cria pedidos (N3 só vê; o banco confere de novo). */
export function podeCriarPedido(p: Perfil | null): boolean {
  return !!p && p.papel === 'CLIENTE' && (p.nivel === 1 || p.nivel === 2)
}

/** "+ Novo pedido": indisponível (com explicação) quando a empresa não tem contrato vigente. */
export function BotaoNovoPedido({ perfil, grande = false }: { perfil: Perfil; grande?: boolean }) {
  const semContrato = perfil.empresa_tem_contrato === false
  const classe = `flex items-center justify-center gap-2 rounded-cartao bg-acao px-5 ivo-botao text-acao-texto ${
    grande ? 'min-h-14 w-full text-lg' : 'min-h-12'
  }`
  if (semContrato) {
    return (
      <div className="space-y-1.5" data-testid="novo-pedido-indisponivel">
        <button type="button" disabled aria-describedby="explica-novo-pedido" className={`${classe} w-full opacity-50`}>
          <Icone nome="mais" />
          Novo pedido
        </button>
        <p id="explica-novo-pedido" className="ivo-legenda text-texto-suave">
          {MENSAGENS.SEM_CONTRATO}
        </p>
      </div>
    )
  }
  return (
    <Link to="/pedidos/novo" viewTransition className={classe}>
      <Icone nome="mais" />
      Novo pedido
    </Link>
  )
}

const ORDEM: Filtro[] = ['abertos', 'agendados', 'encerrados']

/** Lista de pedidos do perfil (o banco filtra: N2 os próprios; N1/N3 os da empresa; motorista os atribuídos). */
export function Pedidos() {
  const { perfil } = useSessao()
  const [params, setParams] = useSearchParams()
  const filtro: Filtro = ORDEM.includes(params.get('filtro') as Filtro) ? (params.get('filtro') as Filtro) : 'abertos'
  const { dados, erro, carregando, recarregar } = useConsulta(`pedidos-${filtro}`, () =>
    pedidos.listar(FILTROS[filtro].status),
  )
  useTempoReal(topicoDoPerfil(perfil), recarregar)
  const equipe = perfil?.papel !== 'CLIENTE'

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 md:p-6">
      <CabecalhoTela
        sobretitulo={perfil?.papel === 'CLIENTE' ? (perfil.empresa_nome ?? 'Sua empresa') : 'IVO Transportes'}
        titulo="Pedidos"
        acao={perfil && podeCriarPedido(perfil) ? <BotaoNovoPedido perfil={perfil} /> : undefined}
      />

      <div role="group" aria-label="Filtrar pedidos" className="flex gap-1 rounded-full bg-borda/60 p-1">
        {ORDEM.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={f === filtro}
            onClick={() => setParams(f === 'abertos' ? {} : { filtro: f }, { replace: true })}
            className={`min-h-12 flex-1 rounded-full px-3 text-sm font-bold transition-colors duration-150 motion-reduce:transition-none ${
              f === filtro ? 'bg-superficie text-texto shadow-[var(--sombra)]' : 'text-texto-suave'
            }`}
          >
            {FILTROS[f].rotulo}
          </button>
        ))}
      </div>

      {erro && dados === undefined && <ErroAoCarregar onTentar={recarregar} />}
      {carregando && dados === undefined && (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando os pedidos">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      )}
      {dados && dados.length === 0 && (
        <EstadoVazio icone="lista" titulo="Nenhum pedido aqui">
          {filtro === 'abertos'
            ? 'Pedidos aguardando orçamento ou aprovação aparecem aqui.'
            : filtro === 'agendados'
              ? 'Pedidos aprovados e em andamento aparecem aqui.'
              : 'Pedidos concluídos, cancelados, recusados ou expirados aparecem aqui.'}
        </EstadoVazio>
      )}
      {dados && dados.length > 0 && (
        <ul className="space-y-3" data-testid="lista-pedidos">
          {dados.map((item) => (
            <li key={item.id}>
              <CartaoPedido item={item} mostrarEmpresa={equipe} />
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
