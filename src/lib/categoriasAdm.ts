// Fase 4 (especificação §5.1 e §6.7): "Categorias e preços" do ADM. Nome, descrição e "ativa" de cada categoria
// (`api.salvar_categoria`) e o preço por km e a taxa fixa de cada uma numa versão nova do contrato.
// Publica SÓ por `api.publicar_contrato_categorias`: o `publicar_contrato` antigo cria a versão sem preço por categoria.
import type { CodigoCategoria } from './categorias.ts'
import type { ValoresContrato } from './contratos.ts'
import { chamar, ler } from './pedidos.ts'
import { centavosParaTexto, reaisParaCentavos } from './valores.ts'

export const CODIGOS: readonly CodigoCategoria[] = ['PASSAGEIROS', 'CARGA_LEVE', 'CARGA_PESADA']

/** Só a Carga Pesada (com reboque) cobra taxa fixa; nas outras o banco ignora a taxa (vai 0). */
export const COM_TAXA: CodigoCategoria = 'CARGA_PESADA'

export interface CategoriaAdm {
  codigo: CodigoCategoria
  nome: string
  descricao_curta: string
  ordem: number
  ativa: boolean
}

export interface PrecoCategoria {
  km_cent: number
  taxa_fixa_cent: number
}

export type PrecosCategorias = Record<CodigoCategoria, PrecoCategoria>

/**
 * Preço de cada categoria numa versão: o gravado nela ou, na versão antiga (sem preço por categoria), o que o banco
 * usa: Passageiros e Carga Leve pelo km sem reboque; Carga Pesada pelo km com reboque mais a taxa fixa do reboque.
 */
export function precosDaVersao(
  versao: Pick<ValoresContrato, 'km_sem_reboque_cent' | 'km_com_reboque_cent' | 'taxa_fixa_reboque_cent'> | null,
  precos: PrecosCategorias | null,
): PrecosCategorias | null {
  if (precos) return precos
  if (!versao) return null
  return {
    PASSAGEIROS: { km_cent: versao.km_sem_reboque_cent, taxa_fixa_cent: 0 },
    CARGA_LEVE: { km_cent: versao.km_sem_reboque_cent, taxa_fixa_cent: 0 },
    CARGA_PESADA: { km_cent: versao.km_com_reboque_cent, taxa_fixa_cent: versao.taxa_fixa_reboque_cent },
  }
}

export type FormPrecos = Record<CodigoCategoria, { km: string; taxa: string }>
export type ErrosPrecos = Partial<Record<`${CodigoCategoria}.${'km' | 'taxa'}`, string>>

export function formularioPrecos(precos: PrecosCategorias | null): FormPrecos {
  const linha = (c: CodigoCategoria) => ({
    km: precos ? centavosParaTexto(precos[c].km_cent) : '',
    taxa: precos && c === COM_TAXA ? centavosParaTexto(precos[c].taxa_fixa_cent) : '',
  })
  return { PASSAGEIROS: linha('PASSAGEIROS'), CARGA_LEVE: linha('CARGA_LEVE'), CARGA_PESADA: linha('CARGA_PESADA') }
}

const VALOR_INVALIDO = 'Informe um valor em reais, por exemplo 5,00.'

/** Converte o formulário (reais → centavos). Passageiros e Carga Leve vão com taxa 0 (o banco ignora). */
export function validarPrecos(f: FormPrecos): { ok: true; precos: PrecosCategorias } | { ok: false; erros: ErrosPrecos } {
  const erros: ErrosPrecos = {}
  const precos = {} as PrecosCategorias
  for (const c of CODIGOS) {
    const km = reaisParaCentavos(f[c].km)
    if (km === null) erros[`${c}.km`] = VALOR_INVALIDO
    let taxa: number | null = 0
    if (c === COM_TAXA) {
      taxa = reaisParaCentavos(f[c].taxa)
      if (taxa === null) erros[`${c}.taxa`] = VALOR_INVALIDO
    }
    if (km !== null && taxa !== null) precos[c] = { km_cent: km, taxa_fixa_cent: taxa }
  }
  return Object.keys(erros).length > 0 ? { ok: false, erros } : { ok: true, precos }
}

export const categoriasAdm = {
  /** Todas as categorias (também as inativas) e o preço por categoria da versão `versao` (nulo = versão antiga). */
  ler: (empresa: string | null, versao: number | null) =>
    ler<{ categorias: CategoriaAdm[]; precos: PrecosCategorias | null }>('categorias_adm', {
      p_empresa: empresa,
      p_versao: versao,
    }),
  salvar: (c: CategoriaAdm) => chamar('salvar_categoria', { p: c }),
  /** Sem atualização otimista: a tela só muda com a resposta do servidor. */
  publicar: (empresa: string | null, valores: ValoresContrato, precos: PrecosCategorias, vigenteDesde: Date) =>
    chamar('publicar_contrato_categorias', {
      p_empresa: empresa,
      p: valores,
      p_categorias: precos,
      p_vigente_desde: vigenteDesde.toISOString(),
    }),
}
