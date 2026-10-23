// v2.1: limites do pedido que o cliente preenche, sem nenhuma importação (o teste unitário de `novo/pedirDeNovo.ts`
// roda no CI sem as variáveis do Supabase, e `categorias.ts` traz o cliente do Supabase). O banco confere os mesmos.

/** Diárias (hospedagem) ao pedir: de 0 a 30 (o Ivo vai até 60 na calculadora, `orcar.ts`). */
export const DIARIAS_MAX = 30
/** "Outros custos (opcional)": texto livre, sem valor, até 120 caracteres (o valor vem no orçamento). */
export const MAX_OUTROS_CUSTOS = 120
