import { logErro } from '../_compartilhado/log.ts'
import { criarServidor, registrar, type Contexto } from '../_compartilhado/servidor.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BANIMENTO_PERMANENTE = '876000h'

type Retorno = { ok: boolean; codigo?: string; [campo: string]: unknown }

async function autorizar(ctx: Contexto, usuario: string, acao: 'GERAR_LINK' | 'RESETAR_2FA') {
  const { data, error } = await ctx.usuario.rpc('autorizar_operacao_usuario', { p_usuario: usuario, p_acao: acao })
  if (error) return { negado: { ok: false, codigo: 'CAMPOS_INVALIDOS' } as Retorno }
  if (!data?.ok) return { negado: { ok: false, codigo: String(data?.codigo ?? 'ERRO_INESPERADO') } as Retorno }
  return { email: String(data.email) }
}

async function gerarLink(ctx: Contexto, usuario: string): Promise<Retorno> {
  const permissao = await autorizar(ctx, usuario, 'GERAR_LINK')
  if (permissao.negado) return permissao.negado
  if (!ctx.origem) return { ok: false, codigo: 'ERRO_INESPERADO' }

  const alvo = `usuario:${usuario}`
  const gerado = await ctx.servico.auth.admin.generateLink({
    type: 'recovery',
    email: permissao.email,
    options: { redirectTo: `${ctx.origem}/definir-senha` },
  })
  const link = gerado.data?.properties?.action_link
  if (gerado.error || !link) {
    logErro(ctx.funcao, 'gerar-link', gerado.error ?? undefined)
    await registrar(ctx, ctx.usuarioId, 'GERAR_LINK', alvo, 'ERRO', 'ERRO_AUTH')
    return { ok: false, codigo: 'ERRO_INESPERADO' }
  }
  await registrar(ctx, ctx.usuarioId, 'GERAR_LINK', alvo, 'OK')
  return { ok: true, link }
}

async function definirAtivo(ctx: Contexto, usuario: string, ativo: boolean, motivo: unknown): Promise<Retorno> {
  const { data, error } = await ctx.usuario.rpc('definir_ativo', {
    p_usuario: usuario,
    p_ativo: ativo,
    p_motivo: typeof motivo === 'string' ? motivo : null,
  })
  if (error) return { ok: false, codigo: 'CAMPOS_INVALIDOS' }
  if (!data?.ok) return { ok: false, codigo: String(data?.codigo ?? 'ERRO_INESPERADO') }

  const acao = ativo ? 'REATIVAR_AUTH' : 'DESATIVAR_AUTH'
  const alvo = `usuario:${usuario}`
  const atualizado = await ctx.servico.auth.admin.updateUserById(usuario, {
    ban_duration: ativo ? 'none' : BANIMENTO_PERMANENTE,
  })
  if (atualizado.error) {
    logErro(ctx.funcao, 'banimento', atualizado.error)
    await registrar(ctx, ctx.usuarioId, acao, alvo, 'ERRO', 'ERRO_AUTH')
    return { ok: false, codigo: 'ERRO_INESPERADO' }
  }
  await registrar(ctx, ctx.usuarioId, acao, alvo, 'OK')
  return { ok: true }
}

async function resetar2fa(ctx: Contexto, usuario: string): Promise<Retorno> {
  const permissao = await autorizar(ctx, usuario, 'RESETAR_2FA')
  if (permissao.negado) return permissao.negado

  const alvo = `usuario:${usuario}`
  const lista = await ctx.servico.auth.admin.mfa.listFactors({ userId: usuario })
  if (lista.error) {
    logErro(ctx.funcao, 'listar-fatores', lista.error)
    await registrar(ctx, ctx.usuarioId, 'RESETAR_2FA', alvo, 'ERRO', 'ERRO_AUTH')
    return { ok: false, codigo: 'ERRO_INESPERADO' }
  }
  for (const fator of lista.data.factors) {
    const apagado = await ctx.servico.auth.admin.mfa.deleteFactor({ id: fator.id, userId: usuario })
    if (apagado.error) {
      logErro(ctx.funcao, 'apagar-fator', apagado.error)
      await registrar(ctx, ctx.usuarioId, 'RESETAR_2FA', alvo, 'ERRO', 'ERRO_AUTH')
      return { ok: false, codigo: 'ERRO_INESPERADO' }
    }
  }
  await registrar(ctx, ctx.usuarioId, 'RESETAR_2FA', alvo, 'OK')
  return { ok: true }
}

Deno.serve(
  criarServidor('gerir-usuario', async (ctx) => {
    const { acao, usuario_id: usuario, motivo } = ctx.corpo
    if (typeof usuario !== 'string' || !UUID.test(usuario)) return { ok: false, codigo: 'CAMPOS_INVALIDOS' }

    switch (acao) {
      case 'GERAR_LINK':
        return gerarLink(ctx, usuario)
      case 'DESATIVAR':
        return definirAtivo(ctx, usuario, false, motivo)
      case 'REATIVAR':
        return definirAtivo(ctx, usuario, true, motivo)
      case 'RESETAR_2FA':
        return resetar2fa(ctx, usuario)
      default:
        return { ok: false, codigo: 'CAMPOS_INVALIDOS' }
    }
  }),
)
