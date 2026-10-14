import { Link } from 'react-router'
import { Cartao } from '../design/componentes/Cartao.tsx'

export function NaoEncontrada() {
  return (
    <main className="mx-auto max-w-md p-4">
      <Cartao className="space-y-3">
        <p className="ivo-legenda font-semibold text-texto-suave">Erro 404</p>
        <h1 className="ivo-h2">Página não encontrada</h1>
        <p className="ivo-corpo text-texto-suave">O endereço pode ter mudado ou não existe.</p>
        <Link to="/" className="inline-flex min-h-12 items-center font-semibold underline underline-offset-4">
          Ir para o início
        </Link>
      </Cartao>
    </main>
  )
}
