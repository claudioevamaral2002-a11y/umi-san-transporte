import { Link } from 'react-router'
import { Cartao } from '../design/componentes/Cartao.tsx'

export function Inicio() {
  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <Cartao>
        <h1 className="text-2xl font-bold">Umi San Transporte</h1>
        <p className="text-texto-suave">Fundação do aplicativo — fase 0.</p>
      </Cartao>
      <Link to="/vitrine" viewTransition className="block font-semibold underline underline-offset-4">
        Ver design system
      </Link>
    </main>
  )
}
