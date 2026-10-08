import { Cartao } from '../design/componentes/Cartao.tsx'
import { useSessao } from '../lib/sessao.tsx'

// Provisório: o início por perfil (pendências e atalhos) chega na Task 11.
export function Inicio() {
  const { perfil } = useSessao()
  const primeiroNome = perfil?.nome.split(' ')[0]
  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <Cartao className="space-y-1">
        <p className="ivo-sobretitulo text-texto-suave">Início</p>
        <h1 className="ivo-h1">{primeiroNome ? `Olá, ${primeiroNome}` : 'Olá'}</h1>
        <p className="ivo-corpo text-texto-suave">Bem-vindo à IVO Transportes.</p>
      </Cartao>
    </main>
  )
}
