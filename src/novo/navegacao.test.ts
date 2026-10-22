import { describe, expect, it } from 'vitest'
import type { Nivel, Perfil } from '../lib/estadoSessao.ts'
import { itensDoMenu, type ItemMenu } from './componentes/Menu.tsx'
import { ATALHOS_CLIENTE, itemAtual, temBarraCliente, tituloDaPagina, tituloExato } from './navegacao.ts'

const cliente = (nivel: Nivel): Perfil => ({
  nome: 'Marina Souza',
  papel: 'CLIENTE',
  nivel,
  empresa_id: 'e1',
  empresa_nome: 'Umi San',
  empresa_logo_caminho: null,
  empresa_tem_contrato: true,
  ativo: true,
  senha_pendente: false,
  tem_2fa: false,
})

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

  it('todo atalho da barra do cliente (fora o Pedir) também está no ☰ de todo nível de cliente', () => {
    for (const nivel of [1, 2, 3] as const) {
      const caminhos = itensDoMenu(cliente(nivel)).map((i) => i.para)
      for (const atalho of ATALHOS_CLIENTE.filter((a) => a.para !== '/')) {
        expect(caminhos, `${atalho.rotulo} (N${nivel})`).toContain(atalho.para)
      }
    }
  })

  it('rótulo que é descrição usa o `titulo` do item: no cabeçalho e no h1, só o nome da página', () => {
    const motorista: Perfil = { ...cliente(1), papel: 'MOTORISTA', nivel: null, empresa_id: null, empresa_nome: null, empresa_tem_contrato: null }
    const adm: Perfil = { ...motorista, papel: 'ADM' }
    expect(tituloDaPagina(itensDoMenu(motorista), '/pedidos')).toBe('Minhas corridas')
    expect(tituloExato(itensDoMenu(motorista), '/pedidos')).toBe('Minhas corridas')
    expect(tituloDaPagina(itensDoMenu(adm), '/adm/painel')).toBe('Painel')
    expect(tituloExato(itensDoMenu(adm), '/adm/painel/')).toBe('Painel')
    // Na subpágina, o h1 é o da própria tela.
    expect(tituloExato(itensDoMenu(adm), '/adm/contratos/x')).toBe('')
    expect(tituloDaPagina(itensDoMenu(adm), '/adm/contratos/x')).toBe('Contratos')
    // O ☰ continua com o rótulo descritivo.
    expect(itensDoMenu(motorista).map((i) => i.rotulo)).toContain('Minhas corridas e Pendências')
  })
})
