// Fase 4: categorias do pedido estilo Uber. O preço de cada categoria vem sempre do banco
// (`api.categorias_disponiveis`, a partir do contrato); a tela só exibe e escolhe.
import type { LinhaOrcamento } from './pedidos.ts'
import { ler } from './pedidos.ts'
import { type FormPedido, montarPedido } from './novoPedido.ts'
import type { Carga, Reboque } from './situacao.ts'

export type CodigoCategoria = 'PASSAGEIROS' | 'CARGA_LEVE' | 'CARGA_PESADA'

export interface CategoriaComPreco {
  codigo: CodigoCategoria
  nome: string
  descricao_curta: string
  disponivel: boolean
  total_cent: number | null
  linhas?: LinhaOrcamento[] | null
}

/** "Agora" = primeiro horário livre a partir de agora + 60 min. */
export const MARGEM_AGORA_MIN = 60

export const categorias = {
  /** `km` vai como número JSON (o banco confere o formato); categorias inativas nem vêm. */
  disponiveis: (p: { km: number; levar: boolean; trazer: boolean }) =>
    ler<{ categorias: CategoriaComPreco[] }>('categorias_disponiveis', { p }),
}

/** Corpo de `api.criar_pedido(p)` para a categoria escolhida: veículo do prestador, carga e reboque da categoria. */
export function pedidoDaCategoria(
  c: CategoriaComPreco & { carga: Carga; reboque: Reboque },
  base: FormPedido,
  opcoes: { agora?: boolean } = {},
): Record<string, unknown> {
  const p = montarPedido({ ...base, modalidade: 'VEICULO_PROPRIO', carga: c.carga, reboque: c.reboque })
  p.categoria = c.codigo
  if (opcoes.agora) p.agora = true
  return p
}

/** Primeiro horário (ISO) de `livres` que começa em agora + 60 min ou depois; `null` se o dia não tem (a tela busca o seguinte). */
export function primeiroHorarioAgora(livres: string[], agora: Date): string | null {
  const minimo = agora.getTime() + MARGEM_AGORA_MIN * 60_000
  const validos = livres
    .map((h) => ({ h, t: Date.parse(h) }))
    .filter((x) => Number.isFinite(x.t) && x.t >= minimo)
    .sort((a, b) => a.t - b.t)
  return validos[0]?.h ?? null
}
