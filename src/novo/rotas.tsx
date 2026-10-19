import { createBrowserRouter } from 'react-router'
import { CarregandoPickup } from '../design/componentes/CarregandoPickup.tsx'
import { Cartao } from '../design/componentes/Cartao.tsx'
import { Guarda } from '../lib/guardas.tsx'
import { ErroGeral } from '../telas/ErroGeral.tsx'
import { Raiz } from '../telas/Raiz.tsx'

/** Início provisório do app novo: as telas próprias chegam nas Tarefas 7 a 11. */
function EmConstrucao() {
  return (
    <main className="mx-auto max-w-md p-4">
      <Cartao className="space-y-2">
        <h1 className="ivo-h2">IVO novo — em construção</h1>
        <p className="ivo-corpo text-texto-suave">As telas novas chegam em breve.</p>
      </Cartao>
    </main>
  )
}

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
        children: [{ index: true, Component: EmConstrucao }],
      },
      { path: '*', lazy: async () => ({ Component: (await import('../telas/NaoEncontrada.tsx')).NaoEncontrada }) },
    ],
  },
])
