// Leituras e chamadas ao banco usadas pelas telas (schema `api`). O banco decide quem vê o quê.
import { exigir } from './consulta.ts'
import type { PrecosParaOrcar, RegrasServico, ValoresContrato, VersaoContrato } from './contratos.ts'
import type { Nivel, Papel } from './estadoSessao.ts'
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
  nivel: Nivel | null
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

/** Linha de `api.listar_contratos()`: a tabela modelo (empresa nula) ou uma empresa, com o vigente (se houver). */
export interface ContratoListado {
  empresa_id: string | null
  empresa_nome: string | null
  vigente: VersaoContrato | null
  proxima_vigencia: string | null
}

export interface Configuracao {
  retencao_fotos_dias: number
  alterado_em: string
}

type LinhaListarContratos = Partial<VersaoContrato> & {
  empresa_id: string | null
  empresa_nome: string | null
  versao: number | null
  proxima_vigencia: string | null
}

export const api = {
  empresas: async () => exigir(await supabase.from('empresas').select('id,nome,logo_caminho').order('nome')) as Empresa[],

  /** ADM: tabela modelo (primeira) e cada empresa, com o contrato vigente e a próxima vigência. */
  contratos: async (): Promise<ContratoListado[]> =>
    (exigir(await supabase.rpc('listar_contratos')) as LinhaListarContratos[]).map(
      ({ empresa_id, empresa_nome, proxima_vigencia, ...resto }) => ({
        empresa_id,
        empresa_nome,
        proxima_vigencia: proxima_vigencia ?? null,
        vigente: resto.versao === null || resto.versao === undefined ? null : (resto as VersaoContrato),
      }),
    ),

  /** ADM: todas as versões de uma empresa (`null` = tabela modelo), da vigência mais nova para a mais antiga. */
  historicoContrato: async (empresa: string | null) =>
    exigir(await supabase.rpc('historico_contrato', { p_empresa: empresa })) as VersaoContrato[],

  /** ADM: publica uma versão (empresa `null` = tabela modelo). Sem atualização otimista. */
  publicarContrato: (empresa: string | null, valores: ValoresContrato, vigenteDesde: Date) =>
    rpc('publicar_contrato', { p_empresa: empresa, p: valores, p_vigente_desde: vigenteDesde.toISOString() }),

  /** ADM: configuração global (retenção de fotos). */
  configuracao: async () => (exigir(await supabase.rpc('ler_configuracao')) as Configuracao[])[0] ?? null,

  definirRetencaoFotos: (dias: number) => rpc('definir_retencao_fotos', { p_dias: dias }),

  /** Cliente: regras do contrato vigente da própria empresa (`null` = sem contrato vigente). */
  regrasDoServico: async () => (exigir(await supabase.rpc('regras_do_servico')) as RegrasServico[])[0] ?? null,

  /** Motorista: preços unitários e prazos do contrato vigente da empresa (`null` = sem contrato vigente). */
  precosParaOrcar: async (empresa: string) =>
    (exigir(await supabase.rpc('precos_para_orcar', { p_empresa: empresa })) as PrecosParaOrcar[])[0] ?? null,

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

  alterarPerfil: (usuario: string, nome: string, papel: Papel, empresa: string | null, nivel: Nivel | null) =>
    rpc('alterar_perfil', { p_usuario: usuario, p_nome: nome, p_papel: papel, p_empresa: empresa, p_nivel: nivel }),

  salvarEmpresa: (id: string | null, nome: string) => rpc('salvar_empresa', { p_id: id, p_nome: nome }),

  definirLogo: (empresa: string, caminho: string) =>
    rpc('definir_logo_empresa', { p_empresa: empresa, p_caminho: caminho }),
}
