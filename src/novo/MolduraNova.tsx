import { useEffect, useState } from 'react'
import { Navigate, Outlet, useOutletContext } from 'react-router'
import { Botao } from '../design/componentes/Botao.tsx'
import { Cartao } from '../design/componentes/Cartao.tsx'
import type { Perfil } from '../lib/estadoSessao.ts'
import { useSessao } from '../lib/sessao.tsx'
import { MapaBase, type CarroNoMapa, type Ponto } from './componentes/MapaBase.tsx'
import { APP_ATUAL, Menu } from './componentes/Menu.tsx'

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
 * Extrato, Equipe e as /adm/*, Ruling R12). Só abre espaço para o ☰ fixo no canto.
 */
export function TelaDePagina() {
  return (
    <div className="pt-[calc(env(safe-area-inset-top)+4rem)] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <Outlet />
    </div>
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
