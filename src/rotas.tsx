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
          {
            lazy: async () => ({ Component: (await import('./telas/MolduraAutenticada.tsx')).MolduraAutenticada }),
            children: [
              { index: true, lazy: async () => ({ Component: (await import('./telas/Inicio.tsx')).Inicio }) },
              {
                // Endereço antigo da tabela de preços (fase 1): o ADM vai para Contratos; os demais, "Sem permissão".
                element: <GuardaPapel papeis={['ADM']} />,
                children: [{ path: 'parametros', element: <Navigate to="/adm/contratos" replace /> }],
              },
              {
                element: <GuardaPapel papeis={['CLIENTE']} />,
                children: [
                  { path: 'regras', lazy: async () => ({ Component: (await import('./telas/cliente/Regras.tsx')).Regras }) },
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
