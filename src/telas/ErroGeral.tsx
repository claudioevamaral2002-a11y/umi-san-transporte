import { useEffect, useState } from 'react'
import { useRouteError } from 'react-router'
import { Botao } from '../design/componentes/Botao.tsx'
import { Cartao } from '../design/componentes/Cartao.tsx'
import { recarregarLimpo } from '../lib/atualizacao.ts'

/** Tela de erro da raiz: nunca mostra o erro padrão do React Router. */
export function ErroGeral() {
  const erro = useRouteError()
  const [recarregando, setRecarregando] = useState(false)
  useEffect(() => {
    console.error(erro)
  }, [erro])
  return (
    <main className="mx-auto min-h-dvh max-w-md p-4" data-testid="erro-geral">
      <Cartao className="space-y-3">
        <p className="ivo-sobretitulo text-texto-suave">IVO Transportes</p>
        <h1 className="ivo-h2">Algo deu errado</h1>
        <p className="ivo-corpo text-texto-suave">
          Não foi possível abrir esta tela. Recarregue para buscar a versão mais recente do aplicativo.
        </p>
        <Botao
          variante="principal"
          disabled={recarregando}
          onClick={() => {
            setRecarregando(true)
            void recarregarLimpo()
          }}
        >
          Recarregar
        </Botao>
      </Cartao>
    </main>
  )
}
