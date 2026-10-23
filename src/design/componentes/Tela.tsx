import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react'
import { Botao } from './Botao.tsx'
import { Cartao } from './Cartao.tsx'
import { Icone, type NomeIcone } from './Icone.tsx'

/** Como a tela mostra o próprio nome: num h1 à vista ou num h1 só para leitores de tela (como o da Agenda). */
export type TituloNaTela = 'visivel' | 'oculto'

/**
 * Nome da página no app novo (o do item do ☰, só na própria página do menu) e o registro do h1 da tela. Com ele, o
 * `CabecalhoTela` usa esse nome no h1 e o cabeçalho "← Início" não repete o nome. Sem ele (app atual), nada muda.
 */
export const ContextoTituloPagina = createContext<{
  titulo: string
  registrar: (modo: TituloNaTela) => () => void
} | null>(null)

/**
 * A tela avisa que já mostra o nome da página (`modo`), enquanto estiver aberta. `null` não registra. Fora do app novo,
 * não faz nada.
 */
export function useTituloNaTela(modo: TituloNaTela | null) {
  const registrar = useContext(ContextoTituloPagina)?.registrar
  useLayoutEffect(() => (registrar && modo ? registrar(modo) : undefined), [registrar, modo])
}

/** Cabeçalho das telas autenticadas: sobretítulo, título, descrição e ação à direita (desktop). */
export function CabecalhoTela({
  sobretitulo,
  titulo,
  descricao,
  acao,
}: {
  sobretitulo: string
  titulo: string
  descricao?: ReactNode
  acao?: ReactNode
}) {
  const tituloDaPagina = useContext(ContextoTituloPagina)?.titulo ?? ''
  useTituloNaTela(tituloDaPagina ? 'visivel' : null)
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="ivo-legenda font-semibold text-texto-suave">{sobretitulo}</p>
        <h1 className="ivo-h1">{tituloDaPagina || titulo}</h1>
        {descricao && <p className="ivo-corpo text-texto-suave">{descricao}</p>}
      </div>
      {acao && <div className="shrink-0">{acao}</div>}
    </header>
  )
}

export function EstadoVazio({
  icone,
  titulo,
  children,
}: {
  icone: NomeIcone
  titulo: string
  children?: ReactNode
}) {
  return (
    <Cartao className="flex flex-col items-center gap-2 py-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-fundo text-link">
        <Icone nome={icone} />
      </span>
      <p className="ivo-h3">{titulo}</p>
      {children && <div className="max-w-sm ivo-corpo text-texto-suave">{children}</div>}
    </Cartao>
  )
}

export function ErroAoCarregar({ onTentar }: { onTentar: () => void }) {
  return (
    <Cartao className="space-y-3" role="alert">
      <p className="ivo-h3">Não foi possível carregar</p>
      <p className="ivo-corpo text-texto-suave">Verifique a conexão com a internet e tente de novo.</p>
      <Botao onClick={onTentar}>Tentar de novo</Botao>
    </Cartao>
  )
}
