// v2.1 (especificação §4.3, §4.4 e §5.3): faturamento por Nota Fiscal. O Master gera a fatura da quinzena com a NF
// emitida na prefeitura (número, emissão e PDF), marca como paga ou cancela; o N1 da empresa lê e baixa a NF. O banco
// decide e soma tudo (itens, total, situação): aqui só as chamadas, a quinzena para preencher a tela e o CSV.
// Nenhuma ação é otimista: a tela só muda com a resposta do servidor.
import type { FormaCobranca } from './contratos.ts'
import { csvDeLinhas, valorCsv } from './painelEmpresa.ts'
import { ErroLeitura, chamar, ler } from './pedidos.ts'
import type { TipoLancamento } from './saldo.ts'
import { supabase } from './supabase.ts'
import { diaDe, somarDias, somarMeses } from './tempo.ts'

/** Situação calculada pelo banco: Vencida não é status, é a ABERTA com o vencimento já passado (hoje local). */
export type SituacaoFatura = 'ABERTA' | 'VENCIDA' | 'PAGA' | 'CANCELADA'
export type StatusFatura = Exclude<SituacaoFatura, 'VENCIDA'>

export const ROTULO_SITUACAO: Record<SituacaoFatura, string> = {
  ABERTA: 'Aberta',
  VENCIDA: 'Vencida',
  PAGA: 'Paga',
  CANCELADA: 'Cancelada',
}

/** Quinzena: datas de calendário ("2026-10-01" a "2026-10-15", ou do dia 16 ao último dia do mês). */
export interface Quinzena {
  inicio: string
  fim: string
}

export interface Fatura {
  id: string
  /** Sequencial por empresa. */
  numero: number
  inicio: string
  fim: string
  /** −Σ valor dos itens: o que a empresa deve (> 0). */
  total_cent: number
  nf_numero: string | null
  nf_emitida_em: string | null
  /** `<empresa>/<uuid>.pdf` no bucket privado `notas-fiscais`; abrir com `linkNota`. */
  nf_pdf_caminho: string | null
  vencimento: string | null
  status: StatusFatura
  situacao: SituacaoFatura
  paga_em: string | null
}

/** Um lançamento da fatura (ou do "A faturar"): DEBITO, MULTA, AJUSTE ou ESTORNO, com a corrida quando houver. */
export interface ItemFatura {
  lancamento_id: number
  criado_em: string
  tipo: TipoLancamento
  /** Como no livro-razão: o débito é negativo, o estorno positivo. O cobrado é `-valor_cent`. */
  valor_cent: number
  numero: number | null
  solicitante_nome: string | null
  origem: string | null
  paradas: string[] | null
  destino: string | null
  categoria_nome: string | null
  centro_custo: string | null
}

/** `api.faturas(p_empresa)`: aba Faturas do N1 e a empresa na tela Faturas do Master. */
export interface ResumoFaturas {
  forma_cobranca: FormaCobranca
  /** A quinzena atual mais o que sobrou de antes, ainda sem fatura. */
  a_faturar: { total_cent: number; itens: ItemFatura[] }
  em_aberto_cent: number
  vencidas_cent: number
  faturas: Fatura[]
}

/** Uma linha de `api.faturas_resumo()` (só o Master): cada empresa cuja vigente é Faturado. */
export interface ResumoEmpresaFaturas {
  empresa_id: string
  empresa_nome: string
  a_faturar_cent: number
  em_aberto_cent: number
  vencidas_cent: number
  /** A última quinzena fechada que ainda tem itens; `null` = nada pronto para faturar. */
  quinzena_pronta: Quinzena | null
}

export interface PreviaFatura {
  total_cent: number
  itens: ItemFatura[]
}

/** `api.fatura(p_fatura)`: o cabeçalho e os itens (no formato da prévia). */
export interface DetalheFatura {
  fatura: Fatura
  itens: ItemFatura[]
}

/** A NF da fatura. Sem `vencimento`, o banco usa emissão + 30 dias. */
export interface NotaFiscal {
  numero: string
  emitida_em: string
  pdf_caminho: string
  vencimento?: string | null
}

/** PDF da NF: só `application/pdf`, até 5 MB (o bucket confere de novo). */
export const MAX_PDF_BYTES = 5 * 1024 * 1024
export const BUCKET_NOTAS = 'notas-fiscais'
/** Número da NF: de 1 a 30 caracteres. Motivo do cancelamento: de 3 a 200. */
export const MAX_NUMERO_NF = 30
export const MOTIVO_MIN = 3
export const MOTIVO_MAX = 200
/** Vencimento padrão: emissão + 30 dias (proposta, §8). */
export const DIAS_VENCIMENTO = 30
/** O link assinado da NF vale 60 s: só para abrir ou baixar na hora. */
const VALIDADE_LINK_S = 60

// ------------------------------------------------------------------------------------------------
// Quinzena (America/Sao_Paulo, sem depender do fuso do aparelho)
// ------------------------------------------------------------------------------------------------

/** Último dia do mês de `dia` ("2028-02-10" → "2028-02-29"). */
function ultimoDiaDoMes(dia: string): string {
  return somarDias(somarMeses(`${dia.slice(0, 7)}-01`, 1), -1)
}

/** A quinzena do instante `d` no horário de Brasília: 15/10 23h30 BRT (16/10 02h30 UTC) ainda é 01–15. */
export function quinzenaDe(d: Date): Quinzena {
  const dia = diaDe(d)
  const mes = dia.slice(0, 7)
  return Number(dia.slice(8, 10)) <= 15
    ? { inicio: `${mes}-01`, fim: `${mes}-15` }
    : { inicio: `${mes}-16`, fim: ultimoDiaDoMes(dia) }
}

/** A quinzena anterior à de `agora`: a última que já fechou (a que o "Gerar fatura" escolhe). */
export function ultimaQuinzenaFechada(agora: Date): Quinzena {
  const atual = quinzenaDe(agora)
  if (atual.inicio.endsWith('-16')) return { inicio: `${atual.inicio.slice(0, 7)}-01`, fim: `${atual.inicio.slice(0, 7)}-15` }
  const anterior = somarDias(atual.inicio, -1)
  return { inicio: `${anterior.slice(0, 7)}-16`, fim: anterior }
}

/** Emissão + 30 dias ("2026-10-16" → "2026-11-15"). O Master pode trocar a data. */
export function vencimentoPadrao(emitidaEm: string): string {
  return somarDias(emitidaEm, DIAS_VENCIMENTO)
}

/** "16/10 a 31/10/2026". */
export function rotuloQuinzena(q: Quinzena): string {
  const dm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
  return `${dm(q.inicio)} a ${dm(q.fim)}/${q.fim.slice(0, 4)}`
}

// ------------------------------------------------------------------------------------------------
// NF no storage
// ------------------------------------------------------------------------------------------------

function ehPdf(arquivo: File): boolean {
  return arquivo.type === 'application/pdf' || (arquivo.type === '' && /\.pdf$/i.test(arquivo.name))
}

/**
 * Envia o PDF da NF para `notas-fiscais/<empresa>/<uuid>.pdf` (só o Master consegue) e devolve o caminho para
 * `faturas.gerar` ou `faturas.trocarPdf`. Recusa antes de enviar o que não é PDF, o vazio e o maior que 5 MB.
 */
export async function enviarPdfNota(
  empresa: string,
  arquivo: File,
): Promise<{ ok: true; caminho: string } | { ok: false; codigo: string }> {
  if (!ehPdf(arquivo) || arquivo.size <= 0 || arquivo.size > MAX_PDF_BYTES) return { ok: false, codigo: 'PDF_INVALIDO' }
  const caminho = `${empresa}/${crypto.randomUUID()}.pdf`
  try {
    const { error } = await supabase.storage
      .from(BUCKET_NOTAS)
      .upload(caminho, arquivo, { contentType: 'application/pdf', upsert: false })
    return error ? { ok: false, codigo: 'ERRO_INESPERADO' } : { ok: true, caminho }
  } catch {
    return { ok: false, codigo: 'ERRO_INESPERADO' }
  }
}

/**
 * Link assinado de 60 s para abrir ou baixar a NF (Master, ou o N1 da empresa). Sem permissão: `ErroLeitura`.
 * `baixar`: o storage responde como anexo, e a página pode ir ao link sem abrir janela (nada de pop-up bloqueado).
 */
export async function linkNota(caminho: string, opcoes: { baixar?: boolean } = {}): Promise<string> {
  let link: string | null
  try {
    const notas = supabase.storage.from(BUCKET_NOTAS)
    const { data, error } = await (opcoes.baixar
      ? notas.createSignedUrl(caminho, VALIDADE_LINK_S, { download: true })
      : notas.createSignedUrl(caminho, VALIDADE_LINK_S))
    link = error ? null : (data?.signedUrl ?? null)
  } catch {
    link = null
  }
  if (!link) throw new ErroLeitura('ERRO_INESPERADO')
  return link
}

// ------------------------------------------------------------------------------------------------
// CSV
// ------------------------------------------------------------------------------------------------

/**
 * CSV da fatura com as colunas do CSV do mês: um lançamento por linha, na data dele, com o valor cobrado (o estorno
 * sai negativo), e no fim a linha "Total" com o total da fatura (o mesmo da NF).
 */
export function csvDaFatura(f: Pick<Fatura, 'total_cent'>, itens: readonly ItemFatura[]): string {
  return csvDeLinhas(
    itens.map((i) => ({ ...i, data: i.criado_em, valor_cent: -i.valor_cent })),
    [`Total;;;;;;;;${valorCsv(f.total_cent)}`],
  )
}

// ------------------------------------------------------------------------------------------------
// RPCs (Tarefa 2)
// ------------------------------------------------------------------------------------------------

export const faturas = {
  /** Master ou o N1 da empresa (o N1 pode passar nada: o banco usa a empresa dele). */
  listar: (empresa: string | null = null) => ler<ResumoFaturas>('faturas', { p_empresa: empresa }),
  /** Uma fatura com os itens. */
  ler: (fatura: string) => ler<DetalheFatura>('fatura', { p_fatura: fatura }),
  /** Só o Master: uma linha por empresa no Faturado. */
  resumo: async () => (await ler<{ empresas: ResumoEmpresaFaturas[] }>('faturas_resumo', {})).empresas ?? [],
  /** Só o Master: o que entraria na fatura da quinzena (não grava nada). */
  previa: (empresa: string, inicio: string, fim: string) =>
    ler<PreviaFatura>('previa_fatura', { p_empresa: empresa, p_inicio: inicio, p_fim: fim }),
  /**
   * Só o Master. Recusas: `NAO_FATURADO`, `QUINZENA_INVALIDA`, `QUINZENA_EM_ANDAMENTO`, `NADA_A_FATURAR` e
   * `CAMPOS_INVALIDOS`. Devolve `{ok, fatura, numero}`. O vencimento só vai quando informado.
   */
  gerar: (empresa: string, inicio: string, fim: string, nf: NotaFiscal) => {
    const p_nf: Record<string, unknown> = { numero: nf.numero.trim(), emitida_em: nf.emitida_em, pdf_caminho: nf.pdf_caminho }
    if (nf.vencimento) p_nf.vencimento = nf.vencimento
    return chamar('gerar_fatura', { p_empresa: empresa, p_inicio: inicio, p_fim: fim, p_nf })
  },
  /** Lança o PAGAMENTO_FATURA (o banco garante uma vez só). Recusas: `JA_PROCESSADO`, `FATURA_CANCELADA`. */
  marcarPaga: (fatura: string, pagaEm: string) => chamar('marcar_fatura_paga', { p_fatura: fatura, p_paga_em: pagaEm }),
  /** Só da Aberta; os itens voltam para o "A faturar". Recusa: `FATURA_PAGA`. */
  cancelar: (fatura: string, motivo: string) => chamar('cancelar_fatura', { p_fatura: fatura, p_motivo: motivo.trim() }),
  /** Só enquanto não estiver paga (`FATURA_PAGA`). O caminho vem de `enviarPdfNota`. */
  trocarPdf: (fatura: string, caminho: string) => chamar('trocar_pdf_fatura', { p_fatura: fatura, p_caminho: caminho }),
}
