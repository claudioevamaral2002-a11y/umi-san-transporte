// Tabela de preços e regras (especificação 3; desenho §1). Tipos, rótulos, validação do formulário
// e diferença entre versões. Dinheiro em centavos, percentuais em pontos-base, prazos em horas.
import type { Papel } from './estadoSessao.ts'
import {
  bpParaTexto,
  centavosParaTexto,
  formatarPercentual,
  inteiroPositivo,
  percentualParaBp,
  reaisParaCentavos,
} from './valores.ts'
import { formatarCentavos } from '../design/dinheiro.ts'

export interface Faixa {
  antecedencia_min_horas: number
  multa_bp: number
}

/** Os 14 campos enviados a `api.publicar_parametros` (nomes das colunas). */
export interface ValoresParametros {
  km_sem_reboque_cent: number
  km_com_reboque_cent: number
  taxa_fixa_reboque_cent: number
  retorno_trecho_unico_bp: number
  hora_espera_cent: number
  hospedagem_diaria_cent: number
  diaria_motorista_cent: number
  faixas_cancelamento: Faixa[]
  prazo_orcar_horas: number
  validade_orcamento_horas: number
  limiar_urgente_horas: number
  limite_saldo_negativo_cent: number
  alerta_saldo_baixo_cent: number
  retencao_fotos_dias: number
}

/** Linha de `api.parametros_vigentes` / `api.parametros_historico`. */
export interface VersaoParametros extends ValoresParametros {
  versao: number
  vigente_desde: string
  publicado_em: string
  publicado_por_nome: string | null
}

export type CampoNumerico = Exclude<keyof ValoresParametros, 'faixas_cancelamento'>
export type Tipo = 'dinheiro' | 'percentual' | 'horas' | 'dias'

export interface DefinicaoCampo {
  campo: CampoNumerico
  rotulo: string
  tipo: Tipo
  ajuda?: string
}

export interface Grupo {
  id: 'proprio' | 'umi' | 'comuns'
  titulo: string
  descricao: string
  campos: DefinicaoCampo[]
}

const HOSPEDAGEM: DefinicaoCampo = { campo: 'hospedagem_diaria_cent', rotulo: 'Hospedagem (por diária)', tipo: 'dinheiro' }

/** Ordem e rótulos da tela. A hospedagem é a mesma nas duas modalidades. */
export const GRUPOS: Grupo[] = [
  {
    id: 'proprio',
    titulo: 'Veículo próprio',
    descricao: 'O motorista leva a carga no próprio veículo.',
    campos: [
      { campo: 'km_sem_reboque_cent', rotulo: 'Quilômetro sem reboque', tipo: 'dinheiro' },
      { campo: 'km_com_reboque_cent', rotulo: 'Quilômetro com reboque', tipo: 'dinheiro' },
      { campo: 'taxa_fixa_reboque_cent', rotulo: 'Taxa fixa de reboque', tipo: 'dinheiro' },
      {
        campo: 'retorno_trecho_unico_bp',
        rotulo: 'Retorno em trecho único',
        tipo: 'percentual',
        ajuda: 'Sobre o valor da ida, quando o serviço é só de ida.',
      },
      { campo: 'hora_espera_cent', rotulo: 'Hora de espera', tipo: 'dinheiro' },
      HOSPEDAGEM,
    ],
  },
  {
    id: 'umi',
    titulo: 'Veículo da Umi San',
    descricao: 'O motorista conduz o veículo do cliente (sem cobrança por km).',
    campos: [{ campo: 'diaria_motorista_cent', rotulo: 'Diária do motorista', tipo: 'dinheiro' }, HOSPEDAGEM],
  },
  {
    id: 'comuns',
    titulo: 'Regras comuns',
    descricao: 'Valem para as duas modalidades.',
    campos: [
      { campo: 'prazo_orcar_horas', rotulo: 'Prazo para orçar', tipo: 'horas' },
      { campo: 'validade_orcamento_horas', rotulo: 'Validade do orçamento', tipo: 'horas' },
      {
        campo: 'limiar_urgente_horas',
        rotulo: 'Pedido urgente quando começa em menos de',
        tipo: 'horas',
      },
      { campo: 'limite_saldo_negativo_cent', rotulo: 'Limite de saldo negativo', tipo: 'dinheiro' },
      { campo: 'alerta_saldo_baixo_cent', rotulo: 'Alerta de saldo baixo', tipo: 'dinheiro' },
      { campo: 'retencao_fotos_dias', rotulo: 'Fotos guardadas após a entrega', tipo: 'dias' },
    ],
  },
]

/** Cada campo uma vez (a hospedagem aparece em duas modalidades). */
export const CAMPOS: DefinicaoCampo[] = GRUPOS.flatMap((g) => g.campos).filter(
  (c, i, todos) => todos.findIndex((x) => x.campo === c.campo) === i,
)

/** Padrão da especificação 3 para as faixas de cancelamento. */
export const FAIXAS_PADRAO: Faixa[] = [
  { antecedencia_min_horas: 24, multa_bp: 0 },
  { antecedencia_min_horas: 6, multa_bp: 5000 },
  { antecedencia_min_horas: 0, multa_bp: 10000 },
]

const horas = (n: number) => `${n} h`
const dias = (n: number) => (n === 1 ? '1 dia' : `${n} dias`)

/** Valor já formatado para leitura. */
export function formatarValor(tipo: Tipo, valor: number): string {
  switch (tipo) {
    case 'dinheiro':
      return formatarCentavos(valor)
    case 'percentual':
      return formatarPercentual(valor)
    case 'horas':
      return horas(valor)
    case 'dias':
      return dias(valor)
  }
}

const multa = (bp: number) => (bp === 0 ? 'sem multa' : `multa de ${formatarPercentual(bp)}`)

/**
 * Faixas em frases: [{24,0},{6,5000},{0,10000}] →
 * "24 h ou mais antes: sem multa", "De 6 h a menos de 24 h antes: multa de 50%", "Menos de 6 h antes: multa de 100%".
 */
export function descreverFaixas(faixas: Faixa[]): string[] {
  return faixas.map((f, i) => {
    const anterior = faixas[i - 1]
    const texto = multa(f.multa_bp)
    if (f.antecedencia_min_horas === 0) {
      return anterior ? `Menos de ${horas(anterior.antecedencia_min_horas)} antes: ${texto}` : `Qualquer antecedência: ${texto}`
    }
    if (!anterior) return `${horas(f.antecedencia_min_horas)} ou mais antes: ${texto}`
    return `De ${horas(f.antecedencia_min_horas)} a menos de ${horas(anterior.antecedencia_min_horas)} antes: ${texto}`
  })
}

/** Quem pode publicar: ADM, ou MOTORISTA com a delegação ligada (o banco confere de novo). */
export function podeEditarParametros(
  papel: Papel | null | undefined,
  permissoes: ReadonlyArray<{ chave: string; ativo: boolean }>,
): boolean {
  if (papel === 'ADM') return true
  if (papel !== 'MOTORISTA') return false
  return permissoes.some((p) => p.chave === 'MOTORISTA_EDITA_PARAMETROS' && p.ativo === true)
}

// ------------------------------------------------------------------------------------------------
// Formulário
// ------------------------------------------------------------------------------------------------

export interface FaixaTexto {
  horas: string
  multa: string
}

export interface FormularioParametros {
  campos: Record<CampoNumerico, string>
  faixas: FaixaTexto[]
}

/** Texto inicial de cada campo a partir de uma versão (ou vazio). */
export function formularioDe(versao: ValoresParametros | null): FormularioParametros {
  const campos = {} as Record<CampoNumerico, string>
  for (const c of CAMPOS) {
    const v = versao?.[c.campo]
    campos[c.campo] =
      v === undefined || v === null
        ? ''
        : c.tipo === 'dinheiro'
          ? centavosParaTexto(v)
          : c.tipo === 'percentual'
            ? bpParaTexto(v)
            : String(v)
  }
  const faixas = (versao?.faixas_cancelamento ?? FAIXAS_PADRAO).map((f) => ({
    horas: String(f.antecedencia_min_horas),
    multa: bpParaTexto(f.multa_bp),
  }))
  return { campos, faixas }
}

export const MAX_FAIXAS = 20

const MENSAGEM_TIPO: Record<Tipo, string> = {
  dinheiro: 'Informe um valor em reais, por exemplo 1.234,56.',
  percentual: 'Informe um percentual entre 0 e 100, com até 2 casas.',
  horas: 'Informe um número inteiro de horas, maior que zero.',
  dias: 'Informe um número inteiro de dias, maior que zero.',
}

export type ErrosFormulario = Partial<Record<CampoNumerico | 'faixas', string>>

/** Converte o formulário para o envio. Com qualquer erro, devolve só os erros (nada é enviado). */
export function validarFormulario(
  f: FormularioParametros,
): { ok: true; valores: ValoresParametros } | { ok: false; erros: ErrosFormulario } {
  const erros: ErrosFormulario = {}
  const valores = {} as ValoresParametros
  for (const c of CAMPOS) {
    const texto = f.campos[c.campo] ?? ''
    const v =
      c.tipo === 'dinheiro'
        ? reaisParaCentavos(texto)
        : c.tipo === 'percentual'
          ? percentualParaBp(texto)
          : inteiroPositivo(texto, c.tipo === 'dias' ? 3650 : 8760)
    if (v === null) erros[c.campo] = MENSAGEM_TIPO[c.tipo]
    else valores[c.campo] = v
  }

  const faixas: Faixa[] = []
  if (f.faixas.length < 1 || f.faixas.length > MAX_FAIXAS) {
    erros.faixas = `Use de 1 a ${MAX_FAIXAS} faixas.`
  } else {
    for (const [i, linha] of f.faixas.entries()) {
      const h = /^\d{1,6}$/.test(linha.horas.trim()) ? Number.parseInt(linha.horas.trim(), 10) : null
      const bp = percentualParaBp(linha.multa)
      if (h === null || bp === null) {
        erros.faixas = `Faixa ${i + 1}: informe as horas (número inteiro) e a multa (0 a 100%).`
        break
      }
      faixas.push({ antecedencia_min_horas: h, multa_bp: bp })
    }
    if (!erros.faixas) {
      for (let i = 1; i < faixas.length; i++) {
        if (faixas[i]!.antecedencia_min_horas >= faixas[i - 1]!.antecedencia_min_horas) {
          erros.faixas = 'As horas devem diminuir de uma faixa para a seguinte.'
          break
        }
      }
    }
    if (!erros.faixas && faixas.at(-1)?.antecedencia_min_horas !== 0) {
      erros.faixas = 'A última faixa precisa começar em 0 h (vale até o horário do serviço).'
    }
  }
  valores.faixas_cancelamento = faixas

  return Object.keys(erros).length > 0 ? { ok: false, erros } : { ok: true, valores }
}

// ------------------------------------------------------------------------------------------------
// Diferença entre versões (confirmação antes de publicar)
// ------------------------------------------------------------------------------------------------

export interface Diferenca {
  campo: CampoNumerico | 'faixas_cancelamento'
  rotulo: string
  antes: string | null
  depois: string
  mudou: boolean
}

const textoFaixas = (faixas: Faixa[]) => descreverFaixas(faixas).join('; ')

/** Todos os campos, com o valor atual (ou `null` sem versão anterior) e o novo; `mudou` marca o que muda. */
export function diferencas(atual: ValoresParametros | null, novo: ValoresParametros): Diferenca[] {
  const lista: Diferenca[] = CAMPOS.map((c) => {
    const antes = atual ? atual[c.campo] : null
    return {
      campo: c.campo,
      rotulo: c.rotulo,
      antes: antes === null ? null : formatarValor(c.tipo, antes),
      depois: formatarValor(c.tipo, novo[c.campo]),
      mudou: antes !== novo[c.campo],
    }
  })
  const faixasAntes = atual ? atual.faixas_cancelamento : null
  const igual =
    faixasAntes !== null &&
    faixasAntes.length === novo.faixas_cancelamento.length &&
    faixasAntes.every(
      (f, i) =>
        f.antecedencia_min_horas === novo.faixas_cancelamento[i]!.antecedencia_min_horas &&
        f.multa_bp === novo.faixas_cancelamento[i]!.multa_bp,
    )
  lista.push({
    campo: 'faixas_cancelamento',
    rotulo: 'Faixas de cancelamento',
    antes: faixasAntes ? textoFaixas(faixasAntes) : null,
    depois: textoFaixas(novo.faixas_cancelamento),
    mudou: !igual,
  })
  return lista
}
