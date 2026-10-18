// Formulário do "Novo pedido" (4 passos): estado, máscara de telefone, validação por passo e o corpo de
// `api.criar_pedido(p)`. O banco valida tudo de novo (interno.validar_pedido); isto só guia a tela.
import type { Local } from './enderecos.ts'
import type { Carga, Modalidade, Reboque } from './situacao.ts'

export const DURACAO_PADRAO = 120
export const DURACAO_MIN = 30
export const DURACAO_MAX = 1440
export const PASSO_DURACAO = 30

export interface FormPedido {
  /** Dia escolhido no calendário ("2026-10-09", São Paulo). */
  dia: string | null
  /** Início escolhido nos horários livres (ISO). */
  inicio: string | null
  duracaoMin: number
  origem: string
  destino: string
  /** Fase 3A: ponto escolhido na busca ou no mapa (`null` = texto livre). */
  origemLocal: Local | null
  destinoLocal: Local | null
  /** Rota de carro entre os dois pontos (só estimativa; o motorista confirma os km). */
  kmEstimado: number | null
  minutosEstimados: number | null
  levar: boolean
  trazer: boolean
  contatoNome: string
  contatoTelefone: string
  carga: Carga
  pessoasQtd: number
  equipamentoDesc: string
  pesoKg: string
  dimensoes: string
  modalidade: Modalidade
  reboque: Reboque
  observacoes: string
}

export const FORM_VAZIO: FormPedido = {
  dia: null,
  inicio: null,
  duracaoMin: DURACAO_PADRAO,
  origem: '',
  destino: '',
  origemLocal: null,
  destinoLocal: null,
  kmEstimado: null,
  minutosEstimados: null,
  levar: false,
  trazer: false,
  contatoNome: '',
  contatoTelefone: '',
  carga: 'PESSOAS',
  pessoasQtd: 1,
  equipamentoDesc: '',
  pesoKg: '',
  dimensoes: '',
  modalidade: 'VEICULO_PROPRIO',
  reboque: 'NAO',
  observacoes: '',
}

// Rascunho para atravessar uma recarga: quem está no Novo pedido durante um deploy que muda as regras do banco recebe
// CAMPOS_INVALIDOS do código antigo; o botão "Recarregar" guarda o formulário aqui e a tela nova o retoma no Confira.
export const CHAVE_RASCUNHO = 'ivo:novo-pedido-rascunho'
const VALIDADE_RASCUNHO_MS = 30 * 60_000
type Armazem = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Guarda o formulário (sem quebrar se o armazenamento estiver bloqueado, como na navegação privada). */
export function guardarRascunho(f: FormPedido, armazem: Armazem | null, agora: number): void {
  try {
    armazem?.setItem(CHAVE_RASCUNHO, JSON.stringify({ em: agora, f }))
  } catch {
    // Sem onde guardar: a recarga só não retoma o formulário.
  }
}

/** Devolve o rascunho uma vez só (e o apaga). Descarta se tiver mais de 30 min ou estiver estragado. */
export function lerRascunho(armazem: Armazem | null, agora: number): FormPedido | null {
  try {
    const bruto = armazem?.getItem(CHAVE_RASCUNHO)
    if (bruto == null) return null
    armazem!.removeItem(CHAVE_RASCUNHO)
    const r: unknown = JSON.parse(bruto)
    if (typeof r !== 'object' || r === null) return null
    const { em, f } = r as { em?: unknown; f?: unknown }
    if (typeof em !== 'number' || agora - em < 0 || agora - em > VALIDADE_RASCUNHO_MS) return null
    if (typeof f !== 'object' || f === null || Array.isArray(f)) return null
    // Campos que uma versão anterior não tinha vêm do formulário vazio; o banco confere tudo de novo no envio.
    return { ...FORM_VAZIO, ...(f as Partial<FormPedido>) }
  } catch {
    return null
  }
}

/** A pessoa já digitou/escolheu algo (fechar pede confirmação). */
export function temDados(f: FormPedido): boolean {
  return (
    f.inicio !== null ||
    f.origem.trim() !== '' ||
    f.destino.trim() !== '' ||
    f.levar ||
    f.trazer ||
    f.contatoNome.trim() !== '' ||
    f.contatoTelefone.trim() !== '' ||
    f.equipamentoDesc.trim() !== '' ||
    f.observacoes.trim() !== ''
  )
}

/** Telefone BR enquanto digita: "(47) 3333-1234" ou "(47) 99999-1234" (no máximo 11 dígitos). */
export function mascararTelefone(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  const ddd = d.slice(0, 2)
  const resto = d.slice(2)
  if (resto.length <= 4) return `(${ddd}) ${resto}`
  if (d.length <= 10) return `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`
  return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`
}

/** "12,5" ou "12.5" → 12.5 (até 2 casas, > 0 e ≤ 100.000); vazio ou inválido → `null`. */
export function pesoParaNumero(texto: string): number | null {
  const s = texto.trim().replace(/\s/g, '')
  const m = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(s)
  if (!m) return null
  const n = Number(`${m[1]}.${m[2] ?? '0'}`)
  return n > 0 && n <= 100000 ? n : null
}

export type Passo = 1 | 2 | 3
export type ErrosPedido = Partial<
  Record<
    | 'inicio'
    | 'origem'
    | 'destino'
    | 'trajeto'
    | 'contatoNome'
    | 'contatoTelefone'
    | 'pessoasQtd'
    | 'equipamentoDesc'
    | 'pesoKg'
    | 'dimensoes'
    | 'observacoes',
    string
  >
>

const entre = (s: string, min: number, max: number) => s.trim().length >= min && s.trim().length <= max

/** Erros do passo (vazio = pode continuar). O passo 4 (revisar) usa todos. */
export function validarPasso(passo: Passo, f: FormPedido): ErrosPedido {
  const e: ErrosPedido = {}
  if (passo === 1) {
    if (!f.dia || !f.inicio) e.inicio = 'Escolha o dia e um dos horários livres.'
  }
  if (passo === 2) {
    if (!entre(f.origem, 3, 200)) e.origem = 'Informe a origem (de 3 a 200 caracteres).'
    if (!entre(f.destino, 3, 200)) e.destino = 'Informe o destino (de 3 a 200 caracteres).'
    if (!f.levar && !f.trazer) e.trajeto = 'Marque Levar, Trazer ou os dois.'
    if (f.contatoNome.trim() !== '' && !entre(f.contatoNome, 2, 120)) e.contatoNome = 'Nome de 2 a 120 caracteres.'
    const digitos = f.contatoTelefone.replace(/\D/g, '')
    if (digitos.length > 0 && digitos.length !== 10 && digitos.length !== 11) {
      e.contatoTelefone = 'Telefone com DDD: 10 ou 11 dígitos.'
    }
  }
  if (passo === 3) {
    if (f.carga !== 'EQUIPAMENTO' && !(Number.isInteger(f.pessoasQtd) && f.pessoasQtd >= 1 && f.pessoasQtd <= 99)) {
      e.pessoasQtd = 'De 1 a 99 pessoas.'
    }
    if (f.carga !== 'PESSOAS') {
      if (!entre(f.equipamentoDesc, 3, 500)) e.equipamentoDesc = 'Descreva o equipamento (de 3 a 500 caracteres).'
      if (f.pesoKg.trim() !== '' && pesoParaNumero(f.pesoKg) === null) e.pesoKg = 'Peso em kg, por exemplo 120 ou 85,5.'
      if (f.dimensoes.trim().length > 120) e.dimensoes = 'No máximo 120 caracteres.'
    }
    if (f.observacoes.length > 1000) e.observacoes = 'No máximo 1000 caracteres.'
  }
  return e
}

/** Primeiro passo com erro (para "Editar"/voltar), ou `null` se tudo certo. */
export function primeiroPassoComErro(f: FormPedido): Passo | null {
  for (const p of [1, 2, 3] as const) if (Object.keys(validarPasso(p, f)).length > 0) return p
  return null
}

const ouNulo = (s: string) => (s.trim() === '' ? null : s.trim())

/** Corpo de `api.criar_pedido(p)`: só os campos que valem para a carga escolhida. */
export function montarPedido(f: FormPedido): Record<string, unknown> {
  if (!f.inicio) throw new Error('pedido sem início')
  const pessoas = f.carga !== 'EQUIPAMENTO'
  const equipamento = f.carga !== 'PESSOAS'
  const p: Record<string, unknown> = {
    inicio: f.inicio,
    duracao_min: f.duracaoMin,
    origem: f.origem.trim(),
    destino: f.destino.trim(),
    levar: f.levar,
    trazer: f.trazer,
    carga: f.carga,
    modalidade: f.modalidade,
    reboque: f.reboque,
    contato_nome: ouNulo(f.contatoNome),
    contato_telefone: ouNulo(f.contatoTelefone),
    observacoes: ouNulo(f.observacoes),
  }
  if (pessoas) p.pessoas_qtd = f.pessoasQtd
  // Fase 3A, dentro dos termos do Google: de um ponto do Google vai só o place_id (coordenadas, endereço e km do
  // Google não são guardados); de um ponto marcado no mapa, as coordenadas da própria pessoa.
  for (const [lado, local] of [['origem', f.origemLocal], ['destino', f.destinoLocal]] as const) {
    if (!local) continue
    if (local.place_id) p[`${lado}_place_id`] = local.place_id
    else if (local.lat !== null && local.lng !== null) {
      p[`${lado}_lat`] = local.lat
      p[`${lado}_lng`] = local.lng
    }
  }
  if (equipamento) {
    p.equipamento_desc = f.equipamentoDesc.trim()
    p.peso_kg = f.pesoKg.trim() === '' ? null : pesoParaNumero(f.pesoKg)
    p.dimensoes = ouNulo(f.dimensoes)
  }
  return p
}
