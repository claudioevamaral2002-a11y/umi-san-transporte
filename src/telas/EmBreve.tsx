import { Cartao } from '../design/componentes/Cartao.tsx'

/** Telas já no menu que chegam nas próximas tarefas desta fase. */
export function EmBreve() {
  return (
    <main className="mx-auto max-w-md p-4">
      <Cartao className="space-y-2">
        <p className="ivo-sobretitulo text-texto-suave">Em construção</p>
        <h1 className="ivo-h2">Esta tela chega em breve</h1>
        <p className="ivo-corpo text-texto-suave">Estamos preparando esta parte do app.</p>
      </Cartao>
    </main>
  )
}
