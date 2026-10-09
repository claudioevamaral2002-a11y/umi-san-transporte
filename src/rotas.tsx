import { createBrowserRouter, Navigate, type RouteObject } from 'react-router'
import { CarregandoPickup } from './design/componentes/CarregandoPickup.tsx'
import { Guarda, GuardaPapel } from './lib/guardas.tsx'
import { ErroGeral } from './telas/ErroGeral.tsx'
import { Raiz } from './telas/Raiz.tsx'

// Vitrine do design system: só em desenvolvimento e na build de teste (e2e). A build de produção
// não a inclui (o `define` do vite.config.ts fixa VITE_VITRINE vazio e o import some do bundle).
const vitrine: RouteObject[] =
  import.meta.env.DEV || import.meta.env.VITE_VITRINE === '1'
    ? [
        { path: 'vitrine', lazy: async () => ({ Component: (await import('./telas/Vitrine.tsx')).Vitrine }) },
        // Provoca um erro de renderização para o e2e da tela de erro geral.
        {
          path: 'erro-teste',
          Component: () => {
            throw new Error('erro de teste')
          },
        },
      ]
    : []

export const roteador = createBrowserRouter([
  {
    path: '/',
    Component: Raiz,
    errorElement: <ErroGeral />,
    // Primeira carga das telas sob demanda: pickup só se passar de 400 ms.
    HydrateFallback: () => <CarregandoPickup ativo />,
    children: [
      // Link curto de convite/recuperação: aberto em qualquer estado; nada acontece até "Continuar".
      {
        path: 'c/:codigo',
        lazy: async () => ({ Component: (await import('./telas/entrada/ResgatarLink.tsx')).ResgatarLink }),
      },
      {
        element: <Guarda permitidos={['anonimo']} />,
        children: [
          { path: 'entrar', lazy: async () => ({ Component: (await import('./telas/entrada/Entrar.tsx')).Entrar }) },
        ],
      },
      {
        element: <Guarda permitidos={['definir_senha']} />,
        children: [
          {
            path: 'definir-senha',
            lazy: async () => ({ Component: (await import('./telas/entrada/DefinirSenha.tsx')).DefinirSenha }),
          },
        ],
      },
      {
        element: <Guarda permitidos={['cadastrar_2fa', 'verificar_2fa']} />,
        children: [
          {
            path: 'seguranca/2fa',
            lazy: async () => ({ Component: (await import('./telas/entrada/Seguranca2fa.tsx')).Seguranca2fa }),
          },
        ],
      },
      {
        element: <Guarda permitidos={['inativo']} />,
        children: [
          {
            path: 'sem-acesso',
            lazy: async () => ({ Component: (await import('./telas/entrada/SemAcesso.tsx')).SemAcesso }),
          },
        ],
      },
      {
        element: <Guarda permitidos={['pronto']} />,
        children: [
          // Fluxos de tela cheia (sem o menu): novo pedido do cliente N1/N2 e orçamento do motorista.
          {
            element: <GuardaPapel papeis={['CLIENTE']} niveis={[1, 2]} />,
            children: [
              {
                path: 'pedidos/novo',
                lazy: async () => ({ Component: (await import('./telas/pedidos/NovoPedido.tsx')).NovoPedido }),
              },
            ],
          },
          // Orçar: motorista atribuído ou ADM (o banco confere a atribuição).
          {
            element: <GuardaPapel papeis={['MOTORISTA', 'ADM']} />,
            children: [
              {
                path: 'pedidos/:id/orcar',
                lazy: async () => ({ Component: (await import('./telas/pedidos/Orcar.tsx')).Orcar }),
              },
            ],
          },
          {
            lazy: async () => ({ Component: (await import('./telas/MolduraAutenticada.tsx')).MolduraAutenticada }),
            children: [
              { index: true, lazy: async () => ({ Component: (await import('./telas/Inicio.tsx')).Inicio }) },
              // Pedidos e agenda: todos os perfis (o banco filtra o que cada um vê).
              { path: 'pedidos', lazy: async () => ({ Component: (await import('./telas/pedidos/Pedidos.tsx')).Pedidos }) },
              { path: 'pedidos/:id', lazy: async () => ({ Component: (await import('./telas/pedidos/Pedido.tsx')).Pedido }) },
              { path: 'agenda', lazy: async () => ({ Component: (await import('./telas/agenda/Agenda.tsx')).Agenda }) },
              {
                // Endereço antigo da tabela de preços (fase 1): o ADM vai para Contratos; os demais, "Sem permissão".
                element: <GuardaPapel papeis={['ADM']} />,
                children: [{ path: 'parametros', element: <Navigate to="/adm/contratos" replace /> }],
              },
              {
                element: <GuardaPapel papeis={['CLIENTE']} />,
                children: [
                  { path: 'regras', lazy: async () => ({ Component: (await import('./telas/cliente/Regras.tsx')).Regras }) },
                  // Saldo e extrato da empresa: todos os níveis (N3 também vê).
                  { path: 'extrato', lazy: async () => ({ Component: (await import('./telas/extrato/Extrato.tsx')).Extrato }) },
                ],
              },
              {
                // Gestor da empresa (cliente N1): a própria equipe.
                element: <GuardaPapel papeis={['CLIENTE']} niveis={[1]} />,
                children: [
                  { path: 'equipe', lazy: async () => ({ Component: (await import('./telas/pessoas/Pessoas.tsx')).Equipe }) },
                ],
              },
              {
                element: <GuardaPapel papeis={['MOTORISTA']} />,
                children: [
                  { path: 'tabela', lazy: async () => ({ Component: (await import('./telas/motorista/Tabela.tsx')).Tabela }) },
                ],
              },
              {
                path: 'adm',
                element: <GuardaPapel papeis={['ADM']} />,
                children: [
                  {
                    path: 'contratos',
                    lazy: async () => ({ Component: (await import('./telas/adm/Contratos.tsx')).Contratos }),
                  },
                  {
                    path: 'contratos/:alvo',
                    lazy: async () => ({ Component: (await import('./telas/adm/Contratos.tsx')).ContratoDetalhe }),
                  },
                  // Fase 2B: clientes e crédito (recarga, ajuste, estorno) e painel.
                  { path: 'creditos', lazy: async () => ({ Component: (await import('./telas/adm/Creditos.tsx')).Creditos }) },
                  {
                    path: 'creditos/:empresa',
                    lazy: async () => ({ Component: (await import('./telas/adm/Creditos.tsx')).CreditoEmpresa }),
                  },
                  { path: 'painel', lazy: async () => ({ Component: (await import('./telas/adm/Painel.tsx')).Painel }) },
                  { path: 'usuarios', lazy: async () => ({ Component: (await import('./telas/pessoas/Pessoas.tsx')).Usuarios }) },
                  { path: 'empresas', lazy: async () => ({ Component: (await import('./telas/adm/Empresas.tsx')).Empresas }) },
                  {
                    path: 'configuracoes',
                    lazy: async () => ({ Component: (await import('./telas/adm/Configuracoes.tsx')).Configuracoes }),
                  },
                  {
                    path: 'auditoria',
                    lazy: async () => ({ Component: (await import('./telas/adm/Auditoria.tsx')).Auditoria }),
                  },
                ],
              },
            ],
          },
        ],
      },
      ...vitrine,
      { path: '*', lazy: async () => ({ Component: (await import('./telas/NaoEncontrada.tsx')).NaoEncontrada }) },
    ],
  },
])
