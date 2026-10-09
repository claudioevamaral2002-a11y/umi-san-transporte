// Calculadora do orçamento (motorista): só QUANTIDADES saem do aparelho; preço unitário e total vêm sempre do
// servidor (`api.calcular_orcamento` / `api.enviar_orcamento`, a partir do contrato vigente da empresa).
// Km em décimos e espera em meias horas: inteiros, sem ponto flutuante acumulado nos passos.
import type { Modalidade } from './situacao.ts'
import { centavosParaTexto, reaisParaCentavos } from './valores.ts'

export const MAX_OUTROS = 5

export interface Outro {
  descricao: string
  valor: string
}

export interface FormOrcamento {
  modalidade: Modalidade
  /** Km em décimos (125 = 12,5 km). */
  kmDecimos: number
  usaReboque: boolean
  /** Espera em meias horas (3 = 1,5 h). */
  esperaMeias: number
  diarias: number
  hospedagemDiarias: number
  /** Pedágio/balsa digitado em reais ("35,80"); vazio = 0. */
  pedagio: string
  outros: Outro[]
}

export function formInicial(modalidade: Modalidade, reboque: 'SIM' | 'NAO' | 'NAO_SEI'): FormOrcamento {
  return {
    modalidade,
    kmDecimos: 0,
    usaReboque: reboque === 'SIM',
    esperaMeias: 0,
    diarias: modalidade === 'VEICULO_CLIENTE' ? 1 : 0,
    hospedagemDiarias: 0,
    pedagio: '',
    outros: [],
  }
}

export const KM_MAX_DECIMOS = 1_000_000
export const ESPERA_MAX_MEIAS = 480
export const DIARIAS_MAX = 60

/** Inteiro seguro entre `min` e `max`; senão `null`. */
function inteiroEntre(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : null
}

/**
 * Formulário pré-preenchido com a entrada do orçamento anterior (revisão pedida pelo cliente). A entrada vem do
 * servidor (`orcamento_anterior.entrada`), mas é lida com cuidado: valor estranho cai no padrão do pedido.
 */
export function formDaEntrada(
  entrada: unknown,
  modalidadePedido: Modalidade,
  reboque: 'SIM' | 'NAO' | 'NAO_SEI',
): FormOrcamento {
  const base = formInicial(modalidadePedido, reboque)
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return base
  const e = entrada as Record<string, unknown>
  const modalidade: Modalidade =
    e.modalidade === 'VEICULO_PROPRIO' || e.modalidade === 'VEICULO_CLIENTE' ? e.modalidade : modalidadePedido
  const f: FormOrcamento = { ...formInicial(modalidade, reboque) }
  if (modalidade === 'VEICULO_PROPRIO') {
    f.kmDecimos = inteiroEntre(typeof e.km === 'number' ? Math.round(e.km * 10) : null, 0, KM_MAX_DECIMOS) ?? 0
    if (typeof e.usa_reboque === 'boolean') f.usaReboque = e.usa_reboque
    f.esperaMeias =
      inteiroEntre(typeof e.espera_horas === 'number' ? Math.round(e.espera_horas * 2) : null, 0, ESPERA_MAX_MEIAS) ?? 0
  } else {
    f.diarias = inteiroEntre(e.diarias, 0, DIARIAS_MAX) ?? f.diarias
  }
  f.hospedagemDiarias = inteiroEntre(e.hospedagem_diarias, 0, DIARIAS_MAX) ?? 0
  const pedagio = inteiroEntre(e.pedagio_cent, 0, 999_999_999)
  f.pedagio = pedagio ? centavosParaTexto(pedagio) : ''
  f.outros = (Array.isArray(e.outros) ? e.outros : []).slice(0, MAX_OUTROS).flatMap((o: unknown) => {
    if (!o || typeof o !== 'object') return []
    const { descricao, valor_cent } = o as Record<string, unknown>
    const valor = inteiroEntre(valor_cent, 1, 999_999_999)
    return typeof descricao === 'string' && valor !== null ? [{ descricao, valor: centavosParaTexto(valor) }] : []
  })
  return f
}


/** 125 → "12,5"; 120 → "12". */
export function kmParaTexto(decimos: number): string {
  const inteiro = Math.floor(decimos / 10)
  const resto = decimos % 10
  return resto === 0 ? String(inteiro) : `${inteiro},${resto}`
}

/** "12,5" / "12.5" / "12" → 125; mais de 1 casa, negativo ou acima do máximo → `null`. Vazio → 0. */
export function textoParaKmDecimos(texto: string): number | null {
  const s = texto.trim()
  if (s === '') return 0
  const m = /^(\d{1,6})(?:[.,](\d))?$/.exec(s)
  if (!m) return null
  const n = Number(m[1]) * 10 + Number(m[2] ?? '0')
  return n <= KM_MAX_DECIMOS ? n : null
}

/** 3 → "1,5"; 4 → "2". */
export function meiasParaTexto(meias: number): string {
  return meias % 2 === 0 ? String(meias / 2) : `${Math.floor(meias / 2)},5`
}

/** Limita um passo (+/−) ao intervalo. */
export function limitar(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor))
}

export type ErrosOrcamento = Partial<Record<'pedagio' | 'outros', string>>

/**
 * Entrada de `calcular_orcamento`/`enviar_orcamento`: só os campos da modalidade (campos da outra modalidade o
 * servidor recusa com CAMPOS_INCOMPATIVEIS). "Outros" só com descrição (3–120) e valor > 0.
 */
export function montarEntrada(
  f: FormOrcamento,
): { ok: true; entrada: Record<string, unknown> } | { ok: false; erros: ErrosOrcamento } {
  const erros: ErrosOrcamento = {}
  const pedagio = f.pedagio.trim() === '' ? 0 : reaisParaCentavos(f.pedagio)
  if (pedagio === null || pedagio > 999_999_999) erros.pedagio = 'Informe o pedágio/balsa em reais, por exemplo 35,80.'

  const outros: Array<{ descricao: string; valor_cent: number }> = []
  for (const [i, o] of f.outros.entries()) {
    const descricao = o.descricao.trim()
    const valor = reaisParaCentavos(o.valor)
    if (descricao.length < 3 || descricao.length > 120 || valor === null || valor <= 0 || valor > 999_999_999) {
      erros.outros = `Outros, item ${i + 1}: descrição (3 a 120 caracteres) e valor maior que zero.`
      break
    }
    outros.push({ descricao, valor_cent: valor })
  }
  if (f.outros.length > MAX_OUTROS) erros.outros = `No máximo ${MAX_OUTROS} itens em Outros.`
  if (Object.keys(erros).length > 0) return { ok: false, erros }

  const entrada: Record<string, unknown> = { modalidade: f.modalidade }
  if (f.modalidade === 'VEICULO_PROPRIO') {
    entrada.km = f.kmDecimos / 10
    entrada.usa_reboque = f.usaReboque
    entrada.espera_horas = f.esperaMeias / 2
  } else {
    entrada.diarias = f.diarias
  }
  entrada.pedagio_cent = pedagio ?? 0
  entrada.hospedagem_diarias = f.hospedagemDiarias
  if (outros.length > 0) entrada.outros = outros
  return { ok: true, entrada }
}
