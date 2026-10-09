import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { Icone, type NomeIcone } from '../design/componentes/Icone.tsx'
import { LogoIvo } from '../design/componentes/LogoIvo.tsx'
import { gereEquipe } from '../lib/administracao.ts'
import type { Perfil } from '../lib/estadoSessao.ts'
import { useSessao } from '../lib/sessao.tsx'
import { supabase } from '../lib/supabase.ts'

interface Item {
  para: string
  rotulo: string
  /** Rótulo da aba inferior (celular). */
  curto?: string
  icone: NomeIcone
  /** Só para quem passa no filtro (sem = todos os do grupo). */
  visivel?: (p: Perfil) => boolean
  /** Também aparece como aba inferior no celular. */
  aba?: boolean
}

interface Grupo {
  titulo: string | null
  visivel?: (p: Perfil) => boolean
  itens: Item[]
}

const ehAdm = (p: Perfil) => p.papel === 'ADM'

/** Menu por perfil e nível (Adendo A10): cliente sem preços; motorista sem limites; gestor de frota sem preços. */
export const MENU: Grupo[] = [
  {
    titulo: null,
    itens: [
      { para: '/', rotulo: 'Início', icone: 'casa', aba: true },
      { para: '/pedidos', rotulo: 'Pedidos', icone: 'lista', aba: true },
      { para: '/agenda', rotulo: 'Agenda', icone: 'calendario', aba: true },
      { para: '/regras', rotulo: 'Regras do serviço', curto: 'Regras', icone: 'escudo', aba: true, visivel: (p) => p.papel === 'CLIENTE' },
      { para: '/extrato', rotulo: 'Extrato', icone: 'dinheiro', visivel: (p) => p.papel === 'CLIENTE' },
      { para: '/equipe', rotulo: 'Equipe', icone: 'usuarios', visivel: gereEquipe },
      { para: '/tabela', rotulo: 'Tabela', icone: 'tabela', aba: true, visivel: (p) => p.papel === 'MOTORISTA' },
    ],
  },
  {
    titulo: 'Administração',
    visivel: ehAdm,
    itens: [
      { para: '/adm/contratos', rotulo: 'Contratos', icone: 'tabela', aba: true },
      { para: '/adm/usuarios', rotulo: 'Usuários', curto: 'Admin', icone: 'usuarios', aba: true },
      { para: '/adm/painel', rotulo: 'Painel', icone: 'grafico' },
      { para: '/adm/creditos', rotulo: 'Créditos', icone: 'dinheiro' },
      { para: '/adm/empresas', rotulo: 'Empresas', icone: 'predio' },
      { para: '/adm/configuracoes', rotulo: 'Configurações', icone: 'chave' },
      { para: '/adm/auditoria', rotulo: 'Auditoria', icone: 'lista' },
    ],
  },
]

const permitido = (filtro: ((p: Perfil) => boolean) | undefined, perfil: Perfil | null) =>
  !filtro || (perfil !== null && filtro(perfil))

function gruposDo(perfil: Perfil | null): Grupo[] {
  return MENU.filter((g) => permitido(g.visivel, perfil))
    .map((g) => ({ ...g, itens: g.itens.filter((i) => permitido(i.visivel, perfil)) }))
    .filter((g) => g.itens.length > 0)
}

/** URL assinada (1 h) do logo da empresa do cliente; sem logo ou com erro, `null` (mostra o nome). */
function useLogoEmpresa(caminho: string | null): string | null {
  const [url, setUrl] = useState<{ caminho: string; url: string } | null>(null)
  useEffect(() => {
    if (!caminho) return
    let ativo = true
    void supabase.storage
      .from('logos')
      .createSignedUrl(caminho, 3600)
      .then(({ data }) => {
        if (ativo && data?.signedUrl) setUrl({ caminho, url: data.signedUrl })
      })
    return () => {
      ativo = false
    }
  }, [caminho])
  return caminho && url?.caminho === caminho ? url.url : null
}

function EmpresaCliente({ perfil }: { perfil: Perfil }) {
  const logo = useLogoEmpresa(perfil.empresa_logo_caminho)
  const [falhou, setFalhou] = useState(false)
  const nome = perfil.empresa_nome ?? ''
  return (
    <div
      className="flex h-10 max-w-[55vw] items-center rounded-full bg-papel px-3.5 text-marinho md:max-w-xs"
      data-testid="empresa-cliente"
    >
      {logo && !falhou ? (
        <img src={logo} alt={nome} className="h-7 w-auto max-w-full object-contain" onError={() => setFalhou(true)} />
      ) : (
        <span className="truncate text-sm font-bold">{nome}</span>
      )}
    </div>
  )
}

function classeLink({ isActive }: { isActive: boolean }) {
  return `flex min-h-12 items-center gap-3 rounded-xl px-3 font-semibold ${
    isActive ? 'bg-marinho text-papel sobre-marinho' : 'text-texto hover:bg-borda/60'
  }`
}

function ListaMenu({ grupos, aoNavegar }: { grupos: Grupo[]; aoNavegar?: () => void }) {
  return (
    <>
      {grupos.map((g) => (
        <div key={g.titulo ?? 'geral'} className="space-y-1">
          {g.titulo && <p className="px-3 pt-4 pb-1 ivo-sobretitulo text-texto-suave">{g.titulo}</p>}
          <ul className="space-y-1">
            {g.itens.map((item) => (
              <li key={item.para}>
                <NavLink to={item.para} end={item.para === '/'} viewTransition className={classeLink} onClick={aoNavegar}>
                  <Icone nome={item.icone} />
                  {item.rotulo}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

export function MolduraAutenticada() {
  const { perfil, email, sair } = useSessao()
  const grupos = gruposDo(perfil)
  const menu = useRef<HTMLDialogElement>(null)
  const local = useLocation()

  // Fecha o menu ao trocar de tela.
  useEffect(() => {
    menu.current?.close()
  }, [local.pathname])

  // Abas do celular: os destinos principais do perfil (no máximo 4) + "Menu" — até 5 na barra.
  const abas = grupos.flatMap((g) => g.itens.filter((i) => i.aba)).slice(0, 4)

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[16rem_1fr] md:grid-rows-[auto_1fr]">
      <header className="nao-imprimir sobre-marinho sticky top-0 z-20 flex items-center justify-between gap-3 bg-marinho px-4 pt-[calc(env(safe-area-inset-top)+0.625rem)] pb-2.5 text-papel md:col-span-2">
        <NavLink to="/" aria-label="IVO Transportes — início" className="flex min-h-12 items-center rounded-lg">
          <LogoIvo variante="simbolo" cor="branco" altura={34} />
        </NavLink>
        <div className="flex min-w-0 items-center gap-3">
          {perfil?.papel === 'CLIENTE' && <EmpresaCliente perfil={perfil} />}
          <button
            type="button"
            onClick={() => void sair()}
            className="hidden min-h-12 items-center gap-2 rounded-xl px-3 font-semibold text-papel hover:bg-white/10 md:flex"
          >
            <Icone nome="sair" />
            Sair
          </button>
        </div>
      </header>

      <nav aria-label="Menu principal" className="nao-imprimir hidden border-r border-borda bg-superficie p-3 md:block">
        <ListaMenu grupos={grupos} />
      </nav>

      <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />
      </div>

      <nav
        aria-label="Navegação"
        className="nao-imprimir fixed inset-x-0 bottom-0 z-20 border-t border-borda bg-superficie pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="flex">
          {abas.map((a) => (
            <li key={a.para} className="flex-1">
              <NavLink
                to={a.para}
                end={a.para === '/'}
                viewTransition
                className={({ isActive }) =>
                  `flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                    isActive ? 'text-texto' : 'text-texto-suave'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`rounded-full px-4 py-1 ${isActive ? 'bg-acao text-acao-texto' : ''}`}>
                      <Icone nome={a.icone} />
                    </span>
                    {a.curto ?? a.rotulo}
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => menu.current?.showModal()}
              aria-haspopup="dialog"
              className="flex min-h-16 w-full flex-col items-center justify-center gap-0.5 text-xs font-semibold text-texto-suave"
            >
              <span className="rounded-full px-4 py-1">
                <Icone nome="menu" />
              </span>
              Menu
            </button>
          </li>
        </ul>
      </nav>

      <dialog
        ref={menu}
        aria-label="Menu"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close()
        }}
        className="m-0 mt-auto max-h-[85dvh] w-full max-w-none rounded-t-3xl bg-superficie p-0 text-texto backdrop:bg-marinho/60 md:hidden"
      >
        <div className="space-y-1 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between pb-2">
            <div className="min-w-0 px-3">
              <p className="truncate font-bold">{perfil?.nome}</p>
              {email && <p className="truncate ivo-legenda text-texto-suave">{email}</p>}
            </div>
            <button
              type="button"
              onClick={() => menu.current?.close()}
              aria-label="Fechar menu"
              className="flex size-12 shrink-0 items-center justify-center rounded-xl"
            >
              <Icone nome="fechar" />
            </button>
          </div>
          <ListaMenu grupos={grupos} aoNavegar={() => menu.current?.close()} />
          <div className="mt-3 border-t border-borda pt-3">
            <button
              type="button"
              onClick={() => void sair()}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 font-semibold text-texto"
            >
              <Icone nome="sair" />
              Sair
            </button>
          </div>
        </div>
      </dialog>
    </div>
  )
}
