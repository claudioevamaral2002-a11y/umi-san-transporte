// Fase 4: veículos do motorista (o ADM vê e cadastra de todos). O banco confere dono, placa e categorias.
import type { CategoriaAdm } from './categoriasAdm.ts'

/** Código de qualquer categoria do banco (fase 4.1: o Master cria novas). */
export type CodigoDaCategoria = string
import { chamar, ler } from './pedidos.ts'

export type SituacaoVeiculo = 'ATIVO' | 'MANUTENCAO' | 'INATIVO'

export interface Veiculo {
  id: string
  motorista_id: string
  modelo: string
  cor: string
  placa: string
  lugares: number
  carga_max_kg: number
  reboque_desc: string | null
  categorias: CodigoDaCategoria[]
  situacao: SituacaoVeiculo
  criado_em: string
  /** Só para o ADM. */
  motorista_nome?: string
}

export interface EntradaVeiculo {
  id?: string
  modelo: string
  cor: string
  placa: string
  lugares: number
  carga_max_kg: number
  reboque_desc?: string | null
  categorias: CodigoDaCategoria[]
  /** Só o ADM, ao criar. */
  motorista_id?: string
}

/** "abc-1d23" → "ABC1D23" (o banco grava assim). */
export function normalizarPlaca(s: string): string {
  return s.replace(/[\s-]/g, '').toUpperCase()
}

export const veiculos = {
  meus: async () => (await ler<{ veiculos: Veiculo[] }>('meus_veiculos', {})).veiculos,
  salvar: (p: EntradaVeiculo) => chamar('salvar_veiculo', { p: { ...p, placa: normalizarPlaca(p.placa) } }),
  mudarSituacao: (id: string, situacao: SituacaoVeiculo) =>
    chamar('mudar_situacao_veiculo', { p_id: id, p_situacao: situacao }),
}

/** As categorias que um veículo pode atender: ativas e que usam veículo da IVO (não a de veículo do cliente). */
export function categoriasDeVeiculo<T extends Pick<CategoriaAdm, 'ativa' | 'veiculo_cliente'>>(cats: readonly T[]): T[] {
  return cats.filter((c) => c.ativa && !c.veiculo_cliente)
}

/** `{codigo: nome}` das categorias do banco (`categoriasAdm.listar()` ou `categorias_disponiveis`). */
export function nomesDasCategorias(cats: readonly Pick<CategoriaAdm, 'codigo' | 'nome'>[]): Record<string, string> {
  return Object.fromEntries(cats.map((c) => [c.codigo, c.nome]))
}

/** Nome da categoria nas etiquetas do veículo; sem a categoria na lista, o próprio código. */
export function nomeDaCategoria(codigo: string, nomes: Readonly<Record<string, string>>): string {
  return Object.hasOwn(nomes, codigo) ? (nomes[codigo] ?? codigo) : codigo
}

/**
 * @deprecated Lista fixa de antes da 4.1: os nomes vêm do banco (`nomesDasCategorias` + `nomeDaCategoria`).
 * Fica só até a Tarefa 5 trocar `CadastrarVeiculo.tsx` e `MeusVeiculos.tsx`; a Tarefa 5 apaga.
 */
export const NOMES_CATEGORIA: Record<string, string> = {
  PASSAGEIROS: 'Passageiros',
  CARGA_LEVE: 'Carga Leve',
  CARGA_PESADA: 'Carga Pesada',
}

export const SITUACOES: Record<SituacaoVeiculo, string> = {
  ATIVO: 'Ativo',
  MANUTENCAO: 'Em manutenção',
  INATIVO: 'Inativo',
}

/** Placa antiga (ABC1234) ou Mercosul (ABC1D23), já normalizada: a mesma regra do banco. */
export const PLACA_VALIDA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/

/** Formulário "Novo veículo" (mockup 9): texto como a pessoa digitou. */
export interface FormVeiculo {
  modelo: string
  cor: string
  placa: string
  lugares: string
  cargaMaxKg: string
  reboqueDesc: string
  categorias: CodigoDaCategoria[]
}

export const FORM_VEICULO_VAZIO: FormVeiculo = {
  modelo: '',
  cor: '',
  placa: '',
  lugares: '',
  cargaMaxKg: '',
  reboqueDesc: '',
  categorias: [],
}

export type ErrosVeiculo = Partial<Record<keyof FormVeiculo, string>>

export function formDoVeiculo(v: Veiculo): FormVeiculo {
  return {
    modelo: v.modelo,
    cor: v.cor,
    placa: v.placa,
    lugares: String(v.lugares),
    cargaMaxKg: String(v.carga_max_kg),
    reboqueDesc: v.reboque_desc ?? '',
    categorias: [...v.categorias],
  }
}

const inteiro = (texto: string, maximo: number): number | null => {
  const s = texto.trim()
  if (!/^\d{1,5}$/.test(s)) return null
  const n = Number.parseInt(s, 10)
  return n <= maximo ? n : null
}

/** Confere o formulário com as mesmas regras do banco; sem erro, devolve a entrada de `salvar_veiculo`. */
export function validarVeiculo(f: FormVeiculo): { ok: true; entrada: EntradaVeiculo } | { ok: false; erros: ErrosVeiculo } {
  const erros: ErrosVeiculo = {}
  const modelo = f.modelo.trim()
  const cor = f.cor.trim()
  const placa = normalizarPlaca(f.placa)
  const reboque = f.reboqueDesc.trim()
  if (modelo.length < 1 || modelo.length > 60) erros.modelo = 'Informe o modelo (até 60 caracteres).'
  if (cor.length < 1 || cor.length > 30) erros.cor = 'Informe a cor (até 30 caracteres).'
  if (!PLACA_VALIDA.test(placa)) erros.placa = 'Placa no formato ABC1D23 ou ABC1234.'
  const lugares = inteiro(f.lugares, 60)
  if (lugares === null) erros.lugares = 'De 0 a 60 lugares.'
  const carga = inteiro(f.cargaMaxKg, 50000)
  if (carga === null) erros.cargaMaxKg = 'De 0 a 50.000 kg.'
  if (reboque.length > 60) erros.reboqueDesc = 'Até 60 caracteres.'
  if (f.categorias.length === 0) erros.categorias = 'Marque pelo menos uma categoria.'
  if (Object.keys(erros).length > 0 || lugares === null || carga === null) return { ok: false, erros }
  return {
    ok: true,
    entrada: {
      modelo,
      cor,
      placa,
      lugares,
      carga_max_kg: carga,
      reboque_desc: reboque === '' ? null : reboque,
      categorias: [...f.categorias],
    },
  }
}
