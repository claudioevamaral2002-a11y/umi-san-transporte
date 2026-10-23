import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Outlet, useLocation, useOutletContext } from 'react-router'
import { Botao } from '../design/componentes/Botao.tsx'
import { Cartao } from '../design/componentes/Cartao.tsx'
import { ContextoRotaDePara } from '../design/componentes/RotaDePara.tsx'
import { ContextoTituloPagina, type TituloNaTela } from '../design/componentes/Tela.tsx'
import type { Perfil } from '../lib/estadoSessao.ts'
import { useSessao } from '../lib/sessao.tsx'
import { MapaBase, type CarroNoMapa, type Ponto } from './componentes/MapaBase.tsx'
import { BarraCliente } from './componentes/BarraCliente.tsx'
import { APP_ATUAL, itensDoMenu, Menu } from './componentes/Menu.tsx'
import { temBarraCliente, tituloDaPagina, tituloExato } from './navegacao.ts'

/**
 * Moldura do app novo (especificação §6): sem barra de abas, só o ☰ no canto superior esquerdo. As telas de mapa
 * ficam dentro de `TelaDeMapa`; as de página (Categorias, Veículos, Painel…) ficam direto aqui.
 */
export function MolduraNova() {
  const { perfil } = useSessao()
  // O gestor de frota não tem telas no app novo (Ruling R13): qualquer endereço mostra o aviso.
  if (perfil?.papel === 'GESTOR_FROTA') return <SemAcessoAoApp />
  return (
    <>
      <header>{perfil && <Menu perfil={perfil} />}</header>
      <Outlet />
    </>
  )
}

export interface CamadasDoMapa {
  rota?: Ponto[]
  carro?: CarroNoMapa
  destino?: Ponto
  centro?: Ponto
}

type DefinirCamadas = (c: CamadasDoMapa) => void

/**
 * Telas de mapa: um só mapa de tela cheia para todas (a sessão de blocos e o Leaflet não recomeçam a cada troca de
 * tela). Cada tela põe o que quer no mapa com `useCamadasDoMapa` e a sua folha com `FolhaMapa`.
 */
export function TelaDeMapa() {
  const [camadas, setCamadas] = useState<CamadasDoMapa>({})
  return (
    <main className="h-dvh overflow-hidden">
      <MapaBase {...camadas} />
      <Outlet context={setCamadas satisfies DefinirCamadas} />
    </main>
  )
}

/** Rota, carro, destino e centro desta tela no mapa da `TelaDeMapa` (limpa ao sair da tela). */
export function useCamadasDoMapa(camadas: CamadasDoMapa) {
  const definir = useOutletContext<DefinirCamadas>()
  const chave = JSON.stringify(camadas)
  useEffect(() => {
    definir(JSON.parse(chave) as CamadasDoMapa)
  }, [definir, chave])
  useEffect(() => () => definir({}), [definir])
}

/** Telas por perfil no app novo. Fora do perfil, volta ao início (o banco recusa do mesmo jeito). */
export function GuardaPerfil({ permite }: { permite: (p: Perfil) => boolean }) {
  const { perfil } = useSessao()
  // Repassa o contexto da TelaDeMapa: as telas de mapa com guarda também põem camadas no mapa compartilhado.
  const contexto = useOutletContext()
  return perfil && permite(perfil) ? <Outlet context={contexto} /> : <Navigate to="/" replace />
}

/**
 * Telas de página (fora do mapa): as novas (Veículos, Categorias, Perfil…) e as de hoje reusadas (Pedidos, Agenda,
 * Extrato, Equipe e as /adm/*, Ruling R12). Todas com o cabeçalho "← Início" + título ao lado do ☰ fixo (especificação
 * §6.4, mockup 4); o cliente ganha a barra Pedir · Corridas · Agenda · Carteira no celular. As rotas das telas de hoje
 * aparecem como "De → (Parada) → Para".
 */
export function TelaDePagina() {
  const { perfil } = useSessao()
  const { pathname } = useLocation()
  const itens = perfil ? itensDoMenu(perfil) : []
  const titulo = tituloDaPagina(itens, pathname)
  const comBarra = perfil?.papel === 'CLIENTE' && temBarraCliente(pathname)
  // As telas abertas registram o h1 delas (CabecalhoTela e as telas novas): um nome só por página.
  const [registrados, setRegistrados] = useState<TituloNaTela[]>([])
  const registrar = useCallback((modo: TituloNaTela) => {
    setRegistrados((r) => [...r, modo])
    return () =>
      setRegistrados((r) => {
        const i = r.indexOf(modo)
        return i < 0 ? r : [...r.slice(0, i), ...r.slice(i + 1)]
      })
  }, [])
  // Na própria página do menu (não numa subpágina), o h1 das telas de hoje usa o mesmo nome do menu.
  const exato = tituloExato(itens, pathname)
  const pagina = useMemo(() => ({ titulo: exato, registrar }), [exato, registrar])
  const h1NaTela = registrados.includes('visivel') ? 'visivel' : registrados.includes('oculto') ? 'oculto' : 'nenhum'
  return (
    <ContextoRotaDePara value>
      <ContextoTituloPagina value={pagina}>
        <div
          className={`pt-[calc(env(safe-area-inset-top)+0.75rem)] ${
            comBarra
              ? 'pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
              : 'pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
          }`}
        >
          {/* O ☰ fica fixo à esquerda (size-12 a partir de left-4): o cabeçalho começa depois dele. */}
          <nav aria-label="Página" className="mb-1 flex min-h-12 items-center gap-3 pr-4 pl-20" data-testid="cabecalho-pagina">
            <Link
              to="/"
              className="-ml-2 inline-flex min-h-12 shrink-0 items-center gap-1 rounded-xl px-2 text-sm font-bold text-texto hover:bg-borda/60"
            >
              <span aria-hidden="true">←</span> Início
            </Link>
            {/* Um nome só por página: com o h1 da tela à vista, o título daqui sai; com um h1 só para leitores de tela,
                fica à vista mas escondido deles. */}
            {titulo && h1NaTela !== 'visivel' && (
              <p className="min-w-0 truncate ivo-h3" aria-hidden={h1NaTela === 'oculto' || undefined}>
                {titulo}
              </p>
            )}
          </nav>
          <Outlet />
        </div>
        {comBarra && <BarraCliente />}
      </ContextoTituloPagina>
    </ContextoRotaDePara>
  )
}

/** Gestor de frota no app novo: ainda sem telas aqui; as de hoje continuam no app atual. */
export function SemAcessoAoApp() {
  const { sair } = useSessao()
  return (
    <main className="mx-auto max-w-md p-4 pt-[calc(env(safe-area-inset-top)+2rem)]">
      <Cartao className="space-y-3">
        <p className="ivo-legenda font-semibold text-alerta-texto">Acesso indisponível</p>
        <h1 className="ivo-h2">Sem acesso a este app</h1>
        <p className="ivo-corpo text-texto-suave">
          O seu perfil ainda não tem telas no app novo. Continue usando o app de hoje.
        </p>
        <a
          href={APP_ATUAL}
          className="flex min-h-12 w-full items-center justify-center rounded-botao bg-acao px-5 ivo-botao text-acao-texto"
        >
          Abrir o app de hoje
        </a>
        <Botao className="w-full" onClick={() => void sair()}>
          Sair
        </Botao>
      </Cartao>
    </main>
  )
}
