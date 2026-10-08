import { Outlet, useNavigation } from 'react-router'
import { CarregandoPickup } from '../design/componentes/CarregandoPickup.tsx'
import { LogoIvo } from '../design/componentes/LogoIvo.tsx'

export function Moldura() {
  const carregando = useNavigation().state === 'loading'
  return (
    <div className="min-h-dvh">
      <header className="bg-marinho px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-papel">
        <LogoIvo variante="horizontal" cor="branco" altura={28} />
      </header>
      <CarregandoPickup ativo={carregando} />
      {!carregando && <Outlet />}
    </div>
  )
}
