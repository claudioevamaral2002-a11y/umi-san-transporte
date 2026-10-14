import type { ReactNode } from 'react'
import { Botao } from './Botao.tsx'
import { Cartao } from './Cartao.tsx'
import { Icone, type NomeIcone } from './Icone.tsx'

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
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 space-y-1">
        <p className="ivo-legenda font-semibold text-texto-suave">{sobretitulo}</p>
        <h1 className="ivo-h1">{titulo}</h1>
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
