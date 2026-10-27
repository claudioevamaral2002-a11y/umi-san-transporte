// v2.1: limites do pedido que o cliente preenche, sem nenhuma importação (o teste unitário de `novo/pedirDeNovo.ts`
// roda no CI sem as variáveis do Supabase, e `categorias.ts` traz o cliente do Supabase). O banco confere os mesmos.

/** Diárias (hospedagem) ao pedir: de 0 a 30 (o Ivo vai até 60 na calculadora, `orcar.ts`). */
export const DIARIAS_MAX = 30
/** "Outros custos (opcional)": texto livre, sem valor, até 120 caracteres (o valor vem no orçamento). */
export const MAX_OUTROS_CUSTOS = 120
/** Pessoas num pedido: de 1 a 99 em qualquer categoria; a categoria pode limitar menos (`pessoas_max`). */
export const PESSOAS_MAX = 99

/**
 * v2.2: o contador de pessoas preso no limite da categoria (`null` = sem limite, até 99). Ao trocar para uma categoria
 * menor, desce até o limite e `ajustou` diz à tela para mostrar o aviso. O banco recusa acima (`ACIMA_DA_CAPACIDADE`).
 */
export function limitarPessoas(qtd: number, pessoas_max: number | null | undefined): { qtd: number; ajustou: boolean } {
  const limite = typeof pessoas_max === 'number' && pessoas_max >= 1 ? Math.min(pessoas_max, PESSOAS_MAX) : PESSOAS_MAX
  return qtd > limite ? { qtd: limite, ajustou: true } : { qtd, ajustou: false }
}
