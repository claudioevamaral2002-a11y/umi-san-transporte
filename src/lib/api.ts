// Leituras e chamadas ao banco usadas pelas telas (schema `api`). O banco decide quem vê o quê.
import { exigir } from './consulta.ts'
import type { Papel } from './estadoSessao.ts'
import type { ValoresParametros, VersaoParametros } from './parametros.ts'
import { supabase } from './supabase.ts'

export interface Permissao {
  chave: string
  ativo: boolean
  alterado_em: string | null
}

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

const COLUNAS_PARAMETROS =
  'versao,vigente_desde,publicado_em,publicado_por_nome,km_sem_reboque_cent,km_com_reboque_cent,taxa_fixa_reboque_cent,retorno_trecho_unico_bp,hora_espera_cent,hospedagem_diaria_cent,diaria_motorista_cent,faixas_cancelamento,prazo_orcar_horas,validade_orcamento_horas,limiar_urgente_horas,limite_saldo_negativo_cent,alerta_saldo_baixo_cent,retencao_fotos_dias'

export const api = {
  permissoes: async () =>
    exigir(await supabase.from('permissoes').select('chave,ativo,alterado_em').order('chave')) as Permissao[],

  empresas: async () => exigir(await supabase.from('empresas').select('id,nome,logo_caminho').order('nome')) as Empresa[],

  /** Vigente (no máximo 1) e histórico completo, do mais novo para o mais antigo. */
  parametros: async () => {
    const [vigente, historico] = await Promise.all([
      supabase.from('parametros_vigentes').select(COLUNAS_PARAMETROS).limit(1),
      supabase.from('parametros_historico').select(COLUNAS_PARAMETROS).limit(200),
    ])
    return {
      vigente: ((exigir(vigente) as unknown as VersaoParametros[])[0] ?? null) as VersaoParametros | null,
      historico: exigir(historico) as unknown as VersaoParametros[],
    }
  },

  /** Existe alguma versão publicada (mesmo que ainda não vigente)? */
  temParametros: async () =>
    (exigir(await supabase.from('parametros_historico').select('versao').limit(1)) as unknown[]).length > 0,

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

  publicarParametros: (valores: ValoresParametros, vigenteDesde: Date) =>
    rpc('publicar_parametros', { p: valores, p_vigente_desde: vigenteDesde.toISOString() }),

  alterarPerfil: (usuario: string, nome: string, papel: Papel, empresa: string | null) =>
    rpc('alterar_perfil', { p_usuario: usuario, p_nome: nome, p_papel: papel, p_empresa: empresa }),

  definirPermissao: (chave: string, ativo: boolean, motivo: string) =>
    rpc('definir_permissao', { p_chave: chave, p_ativo: ativo, p_motivo: motivo }),

  salvarEmpresa: (id: string | null, nome: string) => rpc('salvar_empresa', { p_id: id, p_nome: nome }),

  definirLogo: (empresa: string, caminho: string) =>
    rpc('definir_logo_empresa', { p_empresa: empresa, p_caminho: caminho }),
}
