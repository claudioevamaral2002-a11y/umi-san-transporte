// Fase 4: no app novo, toda versão de contrato sai por `publicar_contrato_categorias`, também a da tela Contratos de
// hoje reusada lá (Ruling R12). O `publicar_contrato` antigo criaria a versão sem preço por categoria, e os pedidos do
// app novo voltariam aos preços da modalidade (ledger da Tarefa 1). O app atual continua como está.
import { createContext, useContext, type ReactNode } from 'react'

const Contexto = createContext(false)

export function ProvedorPublicacaoPorCategoria({ children }: { children: ReactNode }) {
  return <Contexto value>{children}</Contexto>
}

export function usePublicacaoPorCategoria(): boolean {
  return useContext(Contexto)
}
