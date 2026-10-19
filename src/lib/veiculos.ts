// Fase 4: veículos do motorista (o ADM vê e cadastra de todos). O banco confere dono, placa e categorias.
import type { CodigoCategoria } from './categorias.ts'
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
  categorias: CodigoCategoria[]
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
  categorias: CodigoCategoria[]
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
