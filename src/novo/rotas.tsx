import { createBrowserRouter } from 'react-router'
import { CarregandoPickup } from '../design/componentes/CarregandoPickup.tsx'
import type { Perfil } from '../lib/estadoSessao.ts'
import { Guarda } from '../lib/guardas.tsx'
import { ErroGeral } from '../telas/ErroGeral.tsx'
import { Raiz } from '../telas/Raiz.tsx'
import { vePainelEmpresa } from './componentes/Menu.tsx'
import { GuardaPerfil, MolduraNova, TelaDeMapa } from './MolduraNova.tsx'
import { CorridaCliente } from './telas/cliente/Corrida.tsx'
import { InicioCliente } from './telas/cliente/InicioCliente.tsx'
import { EmBreve, InicioProvisorio } from './telas/Provisorias.tsx'
import { useSessao } from '../lib/sessao.tsx'

const ehAdm = (p: Perfil) => p.papel === 'ADM'
const ehMotorista = (p: Perfil) => p.papel === 'MOTORISTA'
const ehCliente = (p: Perfil) => p.papel === 'CLIENTE'
const todos = () => true

/** Início sobre o mapa: o cliente pede (Tarefa 8); motorista e ADM ainda no provisório (Tarefa 10). */
function InicioDoPerfil() {
  const { perfil } = useSessao()
  return perfil?.papel === 'CLIENTE' ? <InicioCliente /> : <InicioProvisorio />
}

/** Telas de página que chegam nas próximas tarefas (11 e 14), por enquanto "em breve", cada uma com a sua guarda. */
const PROVISORIAS: Array<{ path: string; titulo: string; permite: (p: Perfil) => boolean }> = [
  { path: 'adm/categorias', titulo: 'Categorias e preços', permite: ehAdm },
  { path: 'adm/veiculos', titulo: 'Veículos', permite: ehAdm },
  { path: 'empresa', titulo: 'Painel da empresa', permite: vePainelEmpresa },
  { path: 'veiculos', titulo: 'Meus veículos', permite: ehMotorista },
  { path: 'corridas-do-mes', titulo: 'Corridas do mês', permite: ehMotorista },
  { path: 'locais', titulo: 'Locais salvos', permite: ehCliente },
  { path: 'perfil', titulo: 'Perfil e segurança', permite: todos },
  { path: 'ajuda', titulo: 'Ajuda', permite: todos },
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
                ],
              },
              ...PROVISORIAS.map(({ path, titulo, permite }) => ({
                element: <GuardaPerfil permite={permite} />,
                children: [{ path, element: <EmBreve titulo={titulo} /> }],
              })),
            ],
          },
        ],
      },
      { path: '*', lazy: async () => ({ Component: (await import('../telas/NaoEncontrada.tsx')).NaoEncontrada }) },
    ],
  },
])
