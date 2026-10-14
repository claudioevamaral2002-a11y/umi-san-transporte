import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Folha } from '../../design/componentes/Folha.tsx'
import { Icone } from '../../design/componentes/Icone.tsx'
import { Skeleton } from '../../design/componentes/Skeleton.tsx'
import { CabecalhoTela, EstadoVazio, ErroAoCarregar } from '../../design/componentes/Tela.tsx'
import { useConsulta } from '../../lib/consulta.ts'
import { MENSAGENS } from '../../lib/erros.ts'
import type { Perfil } from '../../lib/estadoSessao.ts'
import { pedidos } from '../../lib/pedidos.ts'
import { dinheiro, type Saldo } from '../../lib/saldo.ts'
import { semCredito } from '../../lib/saldoExibicao.ts'
import { useSessao } from '../../lib/sessao.tsx'
import { FILTROS, type Filtro } from '../../lib/situacao.ts'
import { useTempoReal } from '../../lib/tempoReal.ts'
import { topicoDoPerfil, topicoSaldo } from '../../lib/topicos.ts'
import { CartaoPedido } from './componentes.tsx'

/** Cliente N1/N2 cria pedidos (N3 só vê; o banco confere de novo). */
export function podeCriarPedido(p: Perfil | null): boolean {
  return !!p && p.papel === 'CLIENTE' && (p.nivel === 1 || p.nivel === 2)
}

/**
 * Por que o cliente não pode abrir um pedido novo agora (`null` = pode): sem contrato vigente, ou sem crédito nenhum
 * (disponível + limite ≤ 0). Enquanto o saldo carrega ou se a leitura falhar, libera: o banco confere de novo.
 */
export function usePedidoIndisponivel(perfil: Perfil | null): string | null {
  return useCreditoParaPedido(perfil).indisponivel
}

/** Saldo da empresa de quem cria pedido (relido a cada evento de saldo) e o motivo de indisponibilidade, se houver. */
export function useCreditoParaPedido(perfil: Perfil | null): { indisponivel: string | null; saldo: Saldo | null } {
  // Só quem cria pedido (cliente N1/N2) lê o saldo aqui: os demais perfis nem chamam (o banco negaria e auditaria).
  const empresa = podeCriarPedido(perfil) ? perfil!.empresa_id : null
  const saldo = useConsulta(empresa ? `pedido-saldo-${empresa}` : 'pedido-saldo-nenhum', async () =>
    empresa ? dinheiro.saldo(null) : null,
  )
  useTempoReal(topicoSaldo(empresa), saldo.recarregar, 'saldo')
  const dados = saldo.dados ?? null
  if (!perfil || !podeCriarPedido(perfil)) return { indisponivel: null, saldo: null }
  if (perfil.empresa_tem_contrato === false) return { indisponivel: MENSAGENS.SEM_CONTRATO, saldo: dados }
  if (dados && semCredito(dados)) return { indisponivel: MENSAGENS.SEM_CREDITO, saldo: dados }
  return { indisponivel: null, saldo: dados }
}

/** "+ Novo pedido": indisponível (com explicação) sem contrato vigente ou sem crédito nenhum. */
export function BotaoNovoPedido({ perfil, grande = false, soDesktop = false }: { perfil: Perfil; grande?: boolean; soDesktop?: boolean }) {
  const motivo = usePedidoIndisponivel(perfil)
  const classe = `flex items-center justify-center gap-2 rounded-cartao bg-acao px-5 ivo-botao text-acao-texto ${
    grande ? 'min-h-14 w-full text-lg' : 'min-h-12'
  }`
  if (motivo) {
    return (
      <div className="space-y-1.5" data-testid="novo-pedido-indisponivel">
        <button type="button" disabled aria-describedby="explica-novo-pedido" className={`${classe} w-full opacity-50`}>
          <Icone nome="mais" />
          Novo pedido
        </button>
        <p id="explica-novo-pedido" className="ivo-legenda text-texto-suave">
          {motivo}
        </p>
      </div>
    )
  }
  return (
    // No celular o "+" flutuante faz esse papel (soDesktop); o motivo de indisponibilidade aparece nos dois.
    <Link to="/pedidos/novo" viewTransition className={`${classe} ${soDesktop ? 'max-md:hidden' : ''}`}>
      <Icone nome="mais" />
      Novo pedido
    </Link>
  )
}

/**
 * "+" laranja do celular (telas principais), só para quem cria pedido. Indisponível (sem contrato ou sem crédito),
 * abre uma folha com o motivo em vez de levar ao Novo pedido.
 */
export function BotaoFlutuanteNovoPedido({ perfil }: { perfil: Perfil }) {
  const motivo = usePedidoIndisponivel(perfil)
  const [explicando, setExplicando] = useState(false)
  if (!podeCriarPedido(perfil)) return null
  const classe =
    'nao-imprimir fixed right-[18px] bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 flex size-[60px] items-center justify-center rounded-[20px] bg-acao text-acao-texto shadow-[0_8px_20px_-6px_rgb(255_106_0/0.55)] transition-transform duration-75 active:scale-95 motion-reduce:transition-none md:hidden'
  if (motivo) {
    return (
      <>
        <button type="button" aria-label="Novo pedido" data-testid="botao-novo-pedido-flutuante" onClick={() => setExplicando(true)} className={`${classe} opacity-60`}>
          <Icone nome="mais" tamanho={28} />
        </button>
        <Folha aberta={explicando} titulo="Novo pedido indisponível" onFechar={() => setExplicando(false)}>
          <p className="ivo-corpo text-texto-suave">{motivo}</p>
        </Folha>
      </>
    )
  }
  return (
    <Link to="/pedidos/novo" viewTransition aria-label="Novo pedido" data-testid="botao-novo-pedido-flutuante" onClick={() => navigator.vibrate?.(10)} className={classe}>
      <Icone nome="mais" tamanho={28} />
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
        acao={perfil && podeCriarPedido(perfil) ? <BotaoNovoPedido perfil={perfil} soDesktop /> : undefined}
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
