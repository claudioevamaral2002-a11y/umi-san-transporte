// Fase 4: categorias do pedido estilo Uber. O preço de cada categoria vem sempre do banco
// (`api.categorias_disponiveis`, a partir do contrato); a tela só exibe e escolhe.
import type { LinhaOrcamento } from './pedidos.ts'
import { ler } from './pedidos.ts'
import { type FormPedido, montarPedido } from './novoPedido.ts'
import { MAX_PARADAS, type Parada, paraPedido } from './paradas.ts'
import type { Carga, Reboque } from './situacao.ts'
import { DIARIAS_MAX } from './limitesPedido.ts'

/** As três categorias de antes da 4.1 (preços e telas antigos). Categorias novas usam `string`: ver `CategoriaComPreco`. */
export type CodigoCategoria = 'PASSAGEIROS' | 'CARGA_LEVE' | 'CARGA_PESADA'

export interface CategoriaComPreco {
  /** Fase 4.1: o Master cria categorias; o código é gerado do nome ("IVO Motorista" vira `MOTORISTA`) e nunca muda. */
  codigo: string
  nome: string
  descricao_curta: string
  disponivel: boolean
  /** `null` = "Indisponível no momento" ou preço pendente (categoria por hora sem as horas). */
  total_cent: number | null
  linhas?: LinhaOrcamento[] | null
  /** O banco devolve como a categoria preenche o pedido (as antigas sem isso caem em `PREENCHIMENTO`). */
  carga?: Carga
  reboque?: Reboque
  /** Ivo dirige o carro da empresa: não exige veículo da IVO e a modalidade do pedido é VEICULO_CLIENTE. */
  veiculo_cliente: boolean
  /** A tarifa tem valor por hora: a tela pede "Horas estimadas". */
  cobra_hora: boolean
  /** A tarifa tem valor por parada. */
  cobra_parada: boolean
  /**
   * v2.1: a tarifa tem diária de hospedagem (`hospedagem_diaria_cent` > 0): a tela mostra "Diárias (hospedagem)".
   * Opcional: o banco anterior não devolvia (sem ela, a categoria não cobra diária).
   */
  cobra_diaria?: boolean
  /**
   * v2.2: até quantas pessoas a categoria leva (`null` = sem limite). O contador para nele e o banco recusa acima
   * (`ACIMA_DA_CAPACIDADE`). Opcional: o banco anterior não devolvia (sem ela, sem limite).
   */
  pessoas_max?: number | null
}

/**
 * Como cada categoria preenche o pedido de hoje (o mesmo de `app.categorias`, conferido de novo pelo banco):
 * Passageiros = pessoas; Carga Leve = equipamento com reboque (fase 4.1); Carga Pesada = equipamento com reboque.
 */
export const PREENCHIMENTO: Record<CodigoCategoria, { carga: Carga; reboque: Reboque }> = {
  PASSAGEIROS: { carga: 'PESSOAS', reboque: 'NAO' },
  CARGA_LEVE: { carga: 'EQUIPAMENTO', reboque: 'SIM' },
  CARGA_PESADA: { carga: 'EQUIPAMENTO', reboque: 'SIM' },
}

/**
 * A categoria com o preenchimento dela: o que o banco devolveu (categorias criadas pelo Master) ou, sem isso, o das três
 * de antes da 4.1; `null` se não há nenhum dos dois.
 */
export function comPreenchimento(c: CategoriaComPreco): (CategoriaComPreco & { carga: Carga; reboque: Reboque }) | null {
  if (c.carga && c.reboque) return { ...c, carga: c.carga, reboque: c.reboque }
  const p = Object.hasOwn(PREENCHIMENTO, c.codigo) ? PREENCHIMENTO[c.codigo as CodigoCategoria] : null
  return p ? { ...c, ...p } : null
}

/** Horas estimadas (categoria cobrada por hora): de 0,5 a 24, de meia em meia hora. */
export const HORAS_MIN = 0.5
export const HORAS_MAX = 24
export const PASSO_HORAS = 0.5
/** Centro de custo: texto livre, opcional, até 80 caracteres. */
export const MAX_CENTRO_CUSTO = 80

// Diárias ao pedir (0 a 30) e "Outros custos" (até 120): num módulo sem importações, que `novo/pedirDeNovo.ts` também usa.
export { DIARIAS_MAX, MAX_OUTROS_CUSTOS } from './limitesPedido.ts'

/** Diárias que vão ao banco: inteiro de 1 a 30 (0 = sem diárias, a chave não vai). */
function diariasParaEnviar(d: number | null | undefined): number | null {
  return typeof d === 'number' && Number.isInteger(d) && d > 0 && d <= DIARIAS_MAX ? d : null
}

/** Botões − / + das diárias: de 1 em 1, preso entre 0 e 30. */
export function mudarDiarias(diarias: number, sentido: 1 | -1): number {
  return Math.min(DIARIAS_MAX, Math.max(0, diarias + sentido))
}

export function horasValidas(h: number): boolean {
  return Number.isFinite(h) && h >= HORAS_MIN && h <= HORAS_MAX && h * 2 === Math.trunc(h * 2)
}

/** Botões − / +: `sentido` 1 ou -1, um passo de 0,5, preso entre 0,5 e 24. */
export function mudarHoras(horas: number, sentido: 1 | -1): number {
  return Math.min(HORAS_MAX, Math.max(HORAS_MIN, horas + sentido * PASSO_HORAS))
}

/**
 * Km da rota com uma casa: o mesmo arredondamento em todo lugar que pede preço por km da rota (categorias do cliente,
 * "Pela tabela" da confirmação e o "Aceitar" do motorista). O banco aceita até uma casa em `categorias_disponiveis`.
 */
export function kmDaRota(km: number): number {
  return Math.round(km * 10) / 10
}

/**
 * Km do pedido: só ida (ou sem retorno) é a ida; ida e volta soma a ida (com paradas) e a volta direta.
 * `null` quando falta a ida.
 */
export function kmDoPedido(p: {
  ida: { km: number } | null
  volta?: { km: number } | null
  levar: boolean
  trazer: boolean
}): number | null {
  if (!p.ida) return null
  if (p.levar && p.trazer && p.volta) return kmDaRota(p.ida.km + p.volta.km)
  return kmDaRota(p.ida.km)
}

/** Diferença de km que não conta como contraproposta (a rota muda um pouco entre aparelhos e horários): 1 km ou 1%. */
export function toleranciaKm(kmRota: number): number {
  return Math.max(1, kmRota * 0.01)
}

/** Maior `km_volta` que `categorias_disponiveis` aceita (o mesmo teto do `km`). */
const KM_VOLTA_MAX = 5000

/** "Agora" = primeiro horário livre a partir de agora + 60 min. */
export const MARGEM_AGORA_MIN = 60

export const categorias = {
  /**
   * `km` vai como número JSON (o banco confere o formato); categorias inativas nem vêm. `paradas` é a quantidade (0 a 3)
   * e `horas` as horas estimadas; sem eles, o preço sai sem essas linhas. Chaves vazias não vão.
   * v2.1: `diarias` (1 a 30) entram como HOSPEDAGEM e `voltaAOrigem` tira o RETORNO. Sem "Ida e volta" na v2.1, o
   * `trazer` vai falso; `true` só para o preço de tabela de um pedido antigo de ida e volta (ConfirmarCorrida).
   */
  disponiveis: (p: {
    km: number
    /** Fase 4.1: km da volta direta (destino → origem). Só vai em ida e volta; o banco soma `km + km_volta`. */
    kmVolta?: number | null
    levar: boolean
    trazer?: boolean
    paradas?: number | null
    horas?: number | null
    diarias?: number | null
    voltaAOrigem?: boolean
  }) => {
    const trazer = p.trazer === true
    const corpo: Record<string, unknown> = { km: p.km, levar: p.levar, trazer }
    if (p.paradas !== undefined && p.paradas !== null && Number.isFinite(p.paradas)) {
      corpo.paradas = Math.min(MAX_PARADAS, Math.max(0, Math.trunc(p.paradas)))
    }
    if (p.horas !== undefined && p.horas !== null && horasValidas(p.horas)) corpo.horas = p.horas
    const diarias = diariasParaEnviar(p.diarias)
    if (diarias !== null) corpo.diarias = diarias
    if (p.voltaAOrigem) corpo.volta_a_origem = true
    if (p.levar && trazer && typeof p.kmVolta === 'number' && Number.isFinite(p.kmVolta)) {
      const volta = kmDaRota(p.kmVolta)
      if (volta >= 0 && volta <= KM_VOLTA_MAX) corpo.km_volta = volta
    }
    return ler<{ categorias: CategoriaComPreco[] }>('categorias_disponiveis', { p: corpo })
  },
}

/**
 * Corpo de `api.criar_pedido(p)` para a categoria escolhida: carga e reboque da categoria; modalidade VEICULO_CLIENTE
 * na categoria de veículo do cliente (IVO Motorista), VEICULO_PROPRIO nas demais. `paradas` (até 3), `horas`
 * (→ `horas_estimadas`) e `centroCusto` (aparado, vazio não vai) só entram quando informados.
 * v2.1: sem "Ida e volta", o pedido novo vai sempre com `trazer: false` (ir e voltar é uma parada e o Para igual ao De);
 * `diarias` (1 a 30 → `diarias_estimadas`) e `outrosCustos` (aparado, vazio não vai) só quando informados, e
 * `volta_a_origem` sempre (falso por padrão).
 */
export function pedidoDaCategoria(
  c: CategoriaComPreco & { carga: Carga; reboque: Reboque },
  base: FormPedido,
  opcoes: {
    agora?: boolean
    paradas?: readonly Parada[]
    horas?: number | null
    centroCusto?: string | null
    diarias?: number | null
    outrosCustos?: string | null
    voltaAOrigem?: boolean
  } = {},
): Record<string, unknown> {
  const p = montarPedido({
    ...base,
    modalidade: c.veiculo_cliente ? 'VEICULO_CLIENTE' : 'VEICULO_PROPRIO',
    carga: c.carga,
    reboque: c.reboque,
  })
  p.categoria = c.codigo
  p.trazer = false
  if (opcoes.agora) p.agora = true
  if (opcoes.paradas && opcoes.paradas.length > 0) p.paradas = paraPedido(opcoes.paradas)
  if (c.cobra_hora && opcoes.horas !== undefined && opcoes.horas !== null) p.horas_estimadas = opcoes.horas
  const cc = opcoes.centroCusto?.trim()
  if (cc) p.centro_custo = cc
  const diarias = diariasParaEnviar(opcoes.diarias)
  if (diarias !== null) p.diarias_estimadas = diarias
  const outros = opcoes.outrosCustos?.trim()
  if (outros) p.outros_custos = outros
  p.volta_a_origem = opcoes.voltaAOrigem === true
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
