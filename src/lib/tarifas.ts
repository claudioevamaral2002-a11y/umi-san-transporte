// Fase 4.1: tabela de preço de cada categoria (`app.tarifas_categoria`). Tudo em centavos (inteiro) e pontos-base;
// "zerado = não cobra". O front só converte o que a pessoa digitou e mostra a revisão; quem calcula é o banco.
import { formatarCentavos } from '../design/dinheiro.ts'
import { bpParaTexto, centavosParaTexto, formatarPercentual, percentualParaBp, reaisParaCentavos } from './valores.ts'

export interface Tarifa {
  taxa_fixa_cent: number
  km_cent: number
  hora_cent: number
  hora_espera_cent: number
  parada_cent: number
  /** Pontos-base (0 a 10000) sobre a linha de km, só em trecho único. */
  retorno_bp: number
  reboque_cent: number
  hospedagem_diaria_cent: number
}

/** Os oito campos do formulário, na ordem da tela, com o rótulo e o campo do banco. */
export const CAMPOS_TARIFA = [
  { campo: 'taxa', chave: 'taxa_fixa_cent', rotulo: 'Taxa fixa', tipo: 'reais' },
  { campo: 'km', chave: 'km_cent', rotulo: 'Por km', tipo: 'reais' },
  { campo: 'hora', chave: 'hora_cent', rotulo: 'Por hora', tipo: 'reais' },
  { campo: 'espera', chave: 'hora_espera_cent', rotulo: 'Hora de espera', tipo: 'reais' },
  { campo: 'parada', chave: 'parada_cent', rotulo: 'Por parada', tipo: 'reais' },
  { campo: 'retorno', chave: 'retorno_bp', rotulo: 'Retorno', tipo: 'percentual' },
  { campo: 'reboque', chave: 'reboque_cent', rotulo: 'Reboque', tipo: 'reais' },
  { campo: 'hospedagem', chave: 'hospedagem_diaria_cent', rotulo: 'Diária de hospedagem', tipo: 'reais' },
] as const satisfies readonly { campo: string; chave: keyof Tarifa; rotulo: string; tipo: 'reais' | 'percentual' }[]

export type CampoTarifa = (typeof CAMPOS_TARIFA)[number]['campo']

/** O que a pessoa digitou em cada campo (reais com vírgula; retorno em %). */
export type FormTarifa = Record<CampoTarifa, string>
export type ErrosTarifa = Partial<Record<CampoTarifa, string>>

export const FORM_TARIFA_VAZIO: FormTarifa = {
  taxa: '',
  km: '',
  hora: '',
  espera: '',
  parada: '',
  retorno: '',
  reboque: '',
  hospedagem: '',
}

const MSG_REAIS = 'Informe um valor em reais, por exemplo 3,50. Deixe zerado se não cobra.'
const MSG_PERCENTUAL = 'Informe um percentual de 0 a 100, por exemplo 20.'

/** A tarifa para os campos de edição. Chaves a mais (como `inicial`, que a leitura traz) são ignoradas. */
export function paraFormulario(t: Tarifa): FormTarifa {
  const f = { ...FORM_TARIFA_VAZIO }
  for (const c of CAMPOS_TARIFA) f[c.campo] = c.tipo === 'reais' ? centavosParaTexto(t[c.chave]) : bpParaTexto(t[c.chave])
  return f
}

/**
 * Converte o formulário (reais → centavos; % → pontos-base). Campo vazio ou ausente vale zero (não cobra);
 * texto ilegível, negativo ou retorno acima de 100% volta em `campos`.
 */
export function doFormulario(f: Partial<FormTarifa>): Tarifa | { erro: string; campos: ErrosTarifa } {
  const campos: ErrosTarifa = {}
  const t: Tarifa = {
    taxa_fixa_cent: 0,
    km_cent: 0,
    hora_cent: 0,
    hora_espera_cent: 0,
    parada_cent: 0,
    retorno_bp: 0,
    reboque_cent: 0,
    hospedagem_diaria_cent: 0,
  }
  for (const c of CAMPOS_TARIFA) {
    const texto = (f[c.campo] ?? '').trim()
    if (texto === '') continue
    const valor = c.tipo === 'reais' ? reaisParaCentavos(texto) : percentualParaBp(texto)
    if (valor === null) campos[c.campo] = c.tipo === 'reais' ? MSG_REAIS : MSG_PERCENTUAL
    else t[c.chave] = valor
  }
  const primeiro = Object.values(campos)[0]
  return primeiro === undefined ? t : { erro: primeiro, campos }
}

// Intl usa espaço sem quebra entre "R$" e o número; na revisão basta o espaço comum.
const reais = (cent: number) => formatarCentavos(cent).replace(/\s/g, ' ')

/** "Por km: R$ 3,50 → R$ 3,80", só dos campos que mudaram. Sem `antes` (categoria nova), o que passa a cobrar. */
export function diferencas(antes: Tarifa | null, depois: Tarifa): string[] {
  const saida: string[] = []
  for (const c of CAMPOS_TARIFA) {
    const novo = depois[c.chave]
    const velho = antes ? antes[c.chave] : null
    if (velho === novo || (velho === null && novo === 0)) continue
    const mostrar = (v: number) => (c.tipo === 'reais' ? reais(v) : formatarPercentual(v))
    saida.push(`${c.rotulo}: ${velho === null ? '—' : mostrar(velho)} → ${mostrar(novo)}`) // varrer-estilo: permitido (revisão do Master: "antes → depois")
  }
  return saida
}
