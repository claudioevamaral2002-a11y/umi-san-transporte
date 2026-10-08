import { Outlet, useNavigation } from 'react-router'
import { CarregandoPickup } from '../design/componentes/CarregandoPickup.tsx'

/** Raiz de todas as rotas: pickup quando a troca de tela passa de 400 ms. */
export function Raiz() {
  const carregando = useNavigation().state === 'loading'
  return (
    <div className="min-h-dvh">
      <CarregandoPickup ativo={carregando} />
      {!carregando && <Outlet />}
    </div>
  )
}
