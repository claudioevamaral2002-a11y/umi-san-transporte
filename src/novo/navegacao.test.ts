import { describe, expect, it } from 'vitest'
import type { ItemMenu } from './componentes/Menu.tsx'
import { itemAtual, temBarraCliente, tituloDaPagina } from './navegacao.ts'

const ITENS: ItemMenu[] = [
  { rotulo: 'Minhas corridas', icone: 'lista', para: '/pedidos' },
  { rotulo: 'Veículos', icone: 'caminhao', para: '/adm/veiculos' },
  { rotulo: 'Painel', icone: 'grafico', para: '/adm/painel' },
]

describe('navegação do app novo', () => {
  it('item atual: a própria página ou uma subpágina, nunca um prefixo solto', () => {
    expect(itemAtual(ITENS, '/pedidos')?.rotulo).toBe('Minhas corridas')
    expect(itemAtual(ITENS, '/pedidos/42')?.rotulo).toBe('Minhas corridas')
    expect(itemAtual(ITENS, '/adm/veiculos/novo')?.rotulo).toBe('Veículos')
    expect(itemAtual(ITENS, '/pedidosx')).toBeUndefined()
    expect(itemAtual(ITENS, '/')).toBeUndefined()
  })

  it('o caminho mais longo vence', () => {
    const itens: ItemMenu[] = [
      { rotulo: 'A', icone: 'lista', para: '/adm' },
      { rotulo: 'B', icone: 'lista', para: '/adm/painel' },
    ]
    expect(itemAtual(itens, '/adm/painel')?.rotulo).toBe('B')
    expect(itemAtual(itens, '/adm/outra')?.rotulo).toBe('A')
  })

  it('título: o rótulo do menu; fora do menu, um nome genérico', () => {
    expect(tituloDaPagina(ITENS, '/pedidos/42')).toBe('Minhas corridas')
    expect(tituloDaPagina([], '/pedidos/42')).toBe('Corridas')
    expect(tituloDaPagina([], '/perfil')).toBe('Perfil e segurança')
    expect(tituloDaPagina([], '/qualquer')).toBe('')
  })

  it('a barra do cliente só fica em Corridas, Agenda e Carteira', () => {
    expect(temBarraCliente('/pedidos')).toBe(true)
    expect(temBarraCliente('/agenda/')).toBe(true)
    expect(temBarraCliente('/extrato')).toBe(true)
    expect(temBarraCliente('/pedidos/42')).toBe(false)
    expect(temBarraCliente('/perfil')).toBe(false)
    expect(temBarraCliente('/')).toBe(false)
  })
})
