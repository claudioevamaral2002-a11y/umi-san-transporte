import { Outlet, useNavigation } from 'react-router'
import { CarregandoPickup } from '../design/componentes/CarregandoPickup.tsx'

export function Moldura() {
  const carregando = useNavigation().state === 'loading'
  return (
    <div className="min-h-dvh">
      <header className="bg-marinho px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-papel">
        <span className="text-lg font-bold">Umi San</span>
      </header>
      <CarregandoPickup ativo={carregando} />
      {!carregando && <Outlet />}
    </div>
  )
}
