// Leituras e chamadas ao banco usadas pelas telas (schema `api`). O banco decide quem vê o quê.
import { exigir } from './consulta.ts'
import type { Papel } from './estadoSessao.ts'
import type { ValoresParametros, VersaoParametros } from './parametros.ts'
import { supabase } from './supabase.ts'

export interface Empresa {
  id: string
  nome: string
  logo_caminho: string | null
}

export interface Usuario {
  usuario_id: string
  nome: string
  email: string
  telefone: string | null
  papel: Papel
  empresa_id: string | null
  empresa_nome: string | null
  ativo: boolean
  senha_pendente: boolean
  tem_2fa: boolean
  criado_em: string
}

export interface RegistroAuditoria {
  id: number
  em: string
  usuario_id: string | null
  usuario_nome: string | null
  papel: Papel | null
  acao: string
  alvo: string | null
  resultado: 'OK' | 'NEGADO' | 'ERRO'
  codigo: string | null
  detalhe: unknown
  ip: string | null
  dispositivo: string | null
}

export interface FiltroAuditoria {
  de: string | null
  ate: string | null
  usuario: string | null
  acao: string | null
  resultado: string | null
  limite: number
}

/** Resposta das RPCs de negócio: `{ok, codigo?, ...}`. Falha de rede/HTTP vira `ERRO_INESPERADO`. */
export type RespostaRpc = { ok: boolean; codigo?: string; [campo: string]: unknown }

async function rpc(nome: string, args: Record<string, unknown>): Promise<RespostaRpc> {
  try {
    const { data, error } = await supabase.rpc(nome, args)
    if (error || !data || typeof data !== 'object' || typeof (data as RespostaRpc).ok !== 'boolean') {
      return { ok: false, codigo: 'ERRO_INESPERADO' }
    }
    return data as RespostaRpc
  } catch {
    return { ok: false, codigo: 'ERRO_INESPERADO' }
  }
}

/** Versão de contrato como vem de `api.listar_contratos()`/`api.historico_contrato()` (sem a retenção de fotos). */
type VersaoContrato = Omit<VersaoParametros, 'retencao_fotos_dias'> & { empresa_id?: string | null }

export const api = {
  empresas: async () => exigir(await supabase.from('empresas').select('id,nome,logo_caminho').order('nome')) as Empresa[],

  /**
   * Tabela modelo (fase 1B, só ADM): vigente (no máximo 1) e histórico, do mais novo para o mais antigo.
   * A retenção de fotos agora é configuração global; entra em cada versão só para a tela atual.
   * (A tela de contratos por empresa vem na Task 3.)
   */
  parametros: async () => {
    const [contratos, historico, configuracao] = await Promise.all([
      supabase.rpc('listar_contratos'),
      supabase.rpc('historico_contrato', { p_empresa: null }),
      supabase.rpc('ler_configuracao'),
    ])
    const retencao = (exigir(configuracao) as Array<{ retencao_fotos_dias: number }>)[0]?.retencao_fotos_dias ?? 30
    const comRetencao = (v: VersaoContrato): VersaoParametros => ({ ...v, retencao_fotos_dias: retencao })
    const modelo = (exigir(contratos) as VersaoContrato[]).find((c) => c.empresa_id === null && c.versao !== null)
    return {
      vigente: modelo ? comRetencao(modelo) : null,
      historico: (exigir(historico) as VersaoContrato[]).map(comRetencao),
    }
  },

  /** Existe alguma versão da tabela modelo (mesmo que ainda não vigente)? */
  temParametros: async () =>
    (exigir(await supabase.rpc('historico_contrato', { p_empresa: null })) as unknown[]).length > 0,

  usuarios: async () => exigir(await supabase.rpc('listar_usuarios')) as Usuario[],

  auditoria: async (f: FiltroAuditoria) =>
    exigir(
      await supabase.rpc('listar_auditoria', {
        p_de: f.de,
        p_ate: f.ate,
        p_usuario: f.usuario,
        p_acao: f.acao,
        p_resultado: f.resultado,
        p_limite: f.limite,
      }),
    ) as RegistroAuditoria[],

  /** Publica a tabela modelo; a retenção de fotos (global) só é gravada se mudou. */
  publicarParametros: async (valores: ValoresParametros, vigenteDesde: Date, retencaoAtual: number | null) => {
    const { retencao_fotos_dias: retencao, ...contrato } = valores
    const r = await rpc('publicar_contrato', { p_empresa: null, p: contrato, p_vigente_desde: vigenteDesde.toISOString() })
    if (!r.ok || retencao === retencaoAtual) return r
    const config = await rpc('definir_retencao_fotos', { p_dias: retencao })
    return config.ok ? r : config
  },

  alterarPerfil: (usuario: string, nome: string, papel: Papel, empresa: string | null) =>
    rpc('alterar_perfil', { p_usuario: usuario, p_nome: nome, p_papel: papel, p_empresa: empresa }),

  salvarEmpresa: (id: string | null, nome: string) => rpc('salvar_empresa', { p_id: id, p_nome: nome }),

  definirLogo: (empresa: string, caminho: string) =>
    rpc('definir_logo_empresa', { p_empresa: empresa, p_caminho: caminho }),
}
