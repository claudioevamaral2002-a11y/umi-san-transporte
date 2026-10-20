import type { ComponentType } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { CarregandoPickup } from '../design/componentes/CarregandoPickup.tsx'
import type { Perfil } from '../lib/estadoSessao.ts'
import { gereEquipe } from '../lib/administracao.ts'
import { Guarda } from '../lib/guardas.tsx'
import { ErroGeral } from '../telas/ErroGeral.tsx'
import { Raiz } from '../telas/Raiz.tsx'
import { vePainelEmpresa } from './componentes/Menu.tsx'
import { GuardaPerfil, MolduraNova, TelaDeMapa, TelaDePagina } from './MolduraNova.tsx'
import { CorridaCliente } from './telas/cliente/Corrida.tsx'
import { InicioCliente } from './telas/cliente/InicioCliente.tsx'
import { Chamada } from './telas/motorista/Chamada.tsx'
import { InicioMotorista } from './telas/motorista/InicioMotorista.tsx'
import { ProporValor } from './telas/motorista/ProporValor.tsx'
import { ViagemNoMapa } from './telas/motorista/ViagemNoMapa.tsx'
import { EmBreve, InicioProvisorio } from './telas/Provisorias.tsx'
import { useSessao } from '../lib/sessao.tsx'

const ehAdm = (p: Perfil) => p.papel === 'ADM'
const ehMotorista = (p: Perfil) => p.papel === 'MOTORISTA'
const ehCliente = (p: Perfil) => p.papel === 'CLIENTE'
const todos = () => true

/** Início sobre o mapa: o cliente pede (Tarefa 8), o motorista responde e dirige (Tarefa 10); o ADM ainda no provisório. */
function InicioDoPerfil() {
  const { perfil } = useSessao()
  if (perfil?.papel === 'CLIENTE') return <InicioCliente />
  if (perfil?.papel === 'MOTORISTA') return <InicioMotorista />
  return <InicioProvisorio />
}

/** Telas de página ainda por fazer ("em breve"), cada uma com a sua guarda. */
const PROVISORIAS: Array<{ path: string; titulo: string; permite: (p: Perfil) => boolean }> = [
  { path: 'locais', titulo: 'Locais salvos', permite: ehCliente },
  { path: 'ajuda', titulo: 'Ajuda', permite: todos },
]

/** Carrega sob demanda o componente `nome` do módulo (as telas de página e as do app atual reusadas). */
const tela =
  <M extends Record<string, unknown>>(carregar: () => Promise<M>, nome: keyof M & string) =>
  async () => ({ Component: (await carregar())[nome] as ComponentType })

/** Cadastrar/editar veículo pelo ADM (escolhe o motorista ao cadastrar). */
const veiculoDoAdm = async () => {
  const { CadastrarVeiculo } = await import('./telas/motorista/CadastrarVeiculo.tsx')
  return { Component: () => <CadastrarVeiculo adm /> }
}

/**
 * Telas do app atual reusadas dentro da moldura nova, na mesma origem (Ruling R12): Pedidos, Agenda, Extrato
 * (Carteira), Equipe e as /adm/* do ADM, com as mesmas guardas de hoje. O banco filtra o que cada um vê.
 */
const TELAS_DO_APP_ATUAL = [
  { path: 'pedidos', lazy: tela(() => import('../telas/pedidos/Pedidos.tsx'), 'Pedidos') },
  // O pedido novo do app novo é o Início (sobre o mapa).
  { path: 'pedidos/novo', element: <Navigate to="/" replace /> },
  { path: 'pedidos/:id', lazy: tela(() => import('./telas/PedidoNoAppNovo.tsx'), 'PedidoNoAppNovo') },
  { path: 'agenda', lazy: tela(() => import('../telas/agenda/Agenda.tsx'), 'Agenda') },
  {
    element: <GuardaPerfil permite={ehCliente} />,
    children: [{ path: 'extrato', lazy: tela(() => import('../telas/extrato/Extrato.tsx'), 'Extrato') }],
  },
  {
    element: <GuardaPerfil permite={gereEquipe} />,
    children: [{ path: 'equipe', lazy: tela(() => import('../telas/pessoas/Pessoas.tsx'), 'Equipe') }],
  },
  {
    path: 'adm',
    element: <GuardaPerfil permite={ehAdm} />,
    children: [
      { path: 'painel', lazy: tela(() => import('../telas/adm/Painel.tsx'), 'Painel') },
      { path: 'contratos', lazy: tela(() => import('../telas/adm/Contratos.tsx'), 'Contratos') },
      { path: 'contratos/:alvo', lazy: tela(() => import('../telas/adm/Contratos.tsx'), 'ContratoDetalhe') },
      { path: 'creditos', lazy: tela(() => import('../telas/adm/Creditos.tsx'), 'Creditos') },
      { path: 'creditos/:empresa', lazy: tela(() => import('../telas/adm/Creditos.tsx'), 'CreditoEmpresa') },
      { path: 'usuarios', lazy: tela(() => import('../telas/pessoas/Pessoas.tsx'), 'Usuarios') },
      { path: 'empresas', lazy: tela(() => import('../telas/adm/Empresas.tsx'), 'Empresas') },
      { path: 'configuracoes', lazy: tela(() => import('../telas/adm/Configuracoes.tsx'), 'Configuracoes') },
      { path: 'auditoria', lazy: tela(() => import('../telas/adm/Auditoria.tsx'), 'Auditoria') },
      // Telas novas do ADM (Tarefa 11).
      { path: 'categorias', lazy: tela(() => import('./telas/adm/CategoriasPrecos.tsx'), 'CategoriasPrecos') },
      { path: 'veiculos', lazy: tela(() => import('./telas/adm/Veiculos.tsx'), 'Veiculos') },
      { path: 'veiculos/novo', lazy: veiculoDoAdm },
      { path: 'veiculos/:id', lazy: veiculoDoAdm },
    ],
  },
]

/** Telas novas de página do motorista (Tarefa 11) e "Perfil e segurança" de todos (Ruling R15). */
const TELAS_NOVAS = [
  {
    element: <GuardaPerfil permite={ehMotorista} />,
    children: [
      { path: 'veiculos', lazy: tela(() => import('./telas/motorista/MeusVeiculos.tsx'), 'MeusVeiculos') },
      { path: 'veiculos/novo', lazy: tela(() => import('./telas/motorista/CadastrarVeiculo.tsx'), 'CadastrarVeiculo') },
      { path: 'veiculos/:id', lazy: tela(() => import('./telas/motorista/CadastrarVeiculo.tsx'), 'CadastrarVeiculo') },
      { path: 'corridas-do-mes', lazy: tela(() => import('./telas/motorista/CorridasDoMes.tsx'), 'CorridasDoMes') },
    ],
  },
  { path: 'perfil', lazy: tela(() => import('./telas/PerfilSeguranca.tsx'), 'PerfilSeguranca') },
]

/**
 * Rotas do segundo site (ivo-novo). Entrada e sessão reusam as telas do app atual (src/telas/entrada),
 * com as mesmas guardas: o estado da sessão leva cada pessoa à tela certa, como hoje.
 */
export const roteadorNovo = createBrowserRouter([
  {
    path: '/',
    Component: Raiz,
    errorElement: <ErroGeral />,
    HydrateFallback: () => <CarregandoPickup ativo />,
    children: [
      {
        path: 'c/:codigo',
        lazy: async () => ({ Component: (await import('../telas/entrada/ResgatarLink.tsx')).ResgatarLink }),
      },
      {
        element: <Guarda permitidos={['anonimo']} />,
        children: [
          { path: 'entrar', lazy: async () => ({ Component: (await import('../telas/entrada/Entrar.tsx')).Entrar }) },
        ],
      },
      {
        element: <Guarda permitidos={['definir_senha']} />,
        children: [
          {
            path: 'definir-senha',
            lazy: async () => ({ Component: (await import('../telas/entrada/DefinirSenha.tsx')).DefinirSenha }),
          },
        ],
      },
      {
        element: <Guarda permitidos={['cadastrar_2fa', 'verificar_2fa']} />,
        children: [
          {
            path: 'seguranca/2fa',
            lazy: async () => ({ Component: (await import('../telas/entrada/Seguranca2fa.tsx')).Seguranca2fa }),
          },
        ],
      },
      // Destino da guarda para quem está inativo (rotaDoEstado).
      {
        element: <Guarda permitidos={['inativo']} />,
        children: [
          {
            path: 'sem-acesso',
            lazy: async () => ({ Component: (await import('../telas/entrada/SemAcesso.tsx')).SemAcesso }),
          },
        ],
      },
      {
        element: <Guarda permitidos={['pronto']} />,
        children: [
          // Orçar de hoje (tela cheia, fora da moldura): o detalhe reusado leva a ele (diária do motorista, ADM).
          {
            element: <GuardaPerfil permite={(p) => ehMotorista(p) || ehAdm(p)} />,
            children: [{ path: 'pedidos/:id/orcar', lazy: tela(() => import('../telas/pedidos/Orcar.tsx'), 'Orcar') }],
          },
          {
            element: <MolduraNova />,
            children: [
              {
                element: <TelaDeMapa />,
                children: [
                  { index: true, Component: InicioDoPerfil },
                  {
                    element: <GuardaPerfil permite={ehCliente} />,
                    children: [{ path: 'corrida/:id', Component: CorridaCliente }],
                  },
                  {
                    element: <GuardaPerfil permite={ehMotorista} />,
                    children: [
                      { path: 'chamada/:id', Component: Chamada },
                      { path: 'viagem/:id', Component: ViagemNoMapa },
                    ],
                  },
                ],
              },
              // Painel da empresa (Tarefa 14, §6.9): página larga com o menu no topo (fora da TelaDePagina).
              {
                element: <GuardaPerfil permite={vePainelEmpresa} />,
                children: [
                  { path: 'empresa', lazy: tela(() => import('./telas/empresa/PainelEmpresa.tsx'), 'PainelEmpresa') },
                ],
              },
              // A calculadora da contraproposta é uma página (mockup 6), fora do mapa.
              {
                element: <GuardaPerfil permite={ehMotorista} />,
                children: [{ path: 'chamada/:id/propor', Component: ProporValor }],
              },
              {
                element: <TelaDePagina />,
                children: [
                  ...TELAS_DO_APP_ATUAL,
                  ...TELAS_NOVAS,
                  ...PROVISORIAS.map(({ path, titulo, permite }) => ({
                    element: <GuardaPerfil permite={permite} />,
                    children: [{ path, element: <EmBreve titulo={titulo} /> }],
                  })),
                ],
              },
            ],
          },
        ],
      },
      { path: '*', lazy: async () => ({ Component: (await import('../telas/NaoEncontrada.tsx')).NaoEncontrada }) },
    ],
  },
])
