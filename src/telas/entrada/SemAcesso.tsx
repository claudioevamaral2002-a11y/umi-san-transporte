import { Botao } from '../../design/componentes/Botao.tsx'
import { Cartao } from '../../design/componentes/Cartao.tsx'
import { LogoIvo } from '../../design/componentes/LogoIvo.tsx'
import { useSessao } from '../../lib/sessao.tsx'

/** Conta desativada ou sem perfil. Reativar exige entrar de novo (a sessão antiga não volta). */
export function SemAcesso() {
  const { sair } = useSessao()
  return (
    <main className="flex min-h-dvh flex-col bg-fundo">
      <div className="bg-marinho px-6 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-6">
        <LogoIvo variante="simbolo" cor="branco" altura={36} />
      </div>
      <div className="mx-auto w-full max-w-md p-4">
        <Cartao className="space-y-3">
          <p className="ivo-legenda font-semibold text-alerta-texto">Acesso indisponível</p>
          <h1 className="ivo-h2">Sua conta não está ativa</h1>
          <p className="ivo-corpo text-texto-suave">
            Fale com o administrador da IVO Transportes. Quando o acesso for liberado, entre de novo.
          </p>
          <Botao variante="principal" className="w-full" onClick={() => void sair()}>
            Sair
          </Botao>
        </Cartao>
      </div>
    </main>
  )
}
