import { useEffect, useState } from 'react'
import { Navigate, Outlet, useOutletContext } from 'react-router'
import type { Perfil } from '../lib/estadoSessao.ts'
import { useSessao } from '../lib/sessao.tsx'
import { MapaBase, type CarroNoMapa, type Ponto } from './componentes/MapaBase.tsx'
import { Menu } from './componentes/Menu.tsx'

/**
 * Moldura do app novo (especificação §6): sem barra de abas, só o ☰ no canto superior esquerdo. As telas de mapa
 * ficam dentro de `TelaDeMapa`; as de página (Categorias, Veículos, Painel…) ficam direto aqui.
 */
export function MolduraNova() {
  const { perfil } = useSessao()
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
