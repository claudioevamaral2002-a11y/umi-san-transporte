import type { ItemMenu } from './componentes/Menu.tsx'

/** O caminho cai em `para` (ele mesmo ou uma subpágina: "/pedidos/42" está em "/pedidos"). O "/" é só o Início. */
const dentroDe = (caminho: string, para: string) =>
  para === '/' ? caminho === '/' : caminho === para || caminho.startsWith(`${para}/`)

/** Item da página atual: o de caminho mais longo que contém o caminho (destacado no ☰). */
export function itemAtual<T extends Pick<ItemMenu, 'para'>>(itens: readonly T[], caminho: string): T | undefined {
  let melhor: T | undefined
  for (const item of itens) {
    if (dentroDe(caminho, item.para) && (!melhor || item.para.length > melhor.para.length)) melhor = item
  }
  return melhor
}

/** Páginas fora do menu do perfil (o ADM abre um pedido pelo painel, por exemplo). */
const TITULOS_FORA_DO_MENU: ReadonlyArray<Pick<ItemMenu, 'para' | 'rotulo'>> = [
  { para: '/pedidos', rotulo: 'Corridas' },
  { para: '/agenda', rotulo: 'Agenda' },
  { para: '/perfil', rotulo: 'Perfil e segurança' },
]

/** Título do cabeçalho da página ("← Início" + título): o rótulo do item do menu ou, fora dele, um nome genérico. */
export function tituloDaPagina(itens: readonly ItemMenu[], caminho: string): string {
  return (itemAtual(itens, caminho) ?? itemAtual(TITULOS_FORA_DO_MENU, caminho))?.rotulo ?? ''
}

/** Atalhos da barra de baixo do cliente no celular (especificação §6.4, mockup 4). */
export const ATALHOS_CLIENTE = [
  { rotulo: 'Pedir', icone: 'mais', para: '/' },
  { rotulo: 'Corridas', icone: 'lista', para: '/pedidos' },
  { rotulo: 'Agenda', icone: 'calendario', para: '/agenda' },
  { rotulo: 'Carteira', icone: 'dinheiro', para: '/extrato' },
] as const satisfies readonly ItemMenu[]

/**
 * A barra só fica nas páginas dela (Corridas, Agenda e Carteira). No detalhe do pedido, a barra de ações é que fica
 * presa ao pé da tela.
 */
export const temBarraCliente = (caminho: string) => {
  const limpo = caminho.length > 1 ? caminho.replace(/\/+$/, '') : caminho
  return ATALHOS_CLIENTE.some((a) => a.para !== '/' && a.para === limpo)
}
