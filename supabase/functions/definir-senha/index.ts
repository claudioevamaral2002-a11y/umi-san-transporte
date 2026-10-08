import { senhaVazada, VerificacaoIndisponivel } from '../_compartilhado/hibp.ts'
import { validarForcaSenha } from '../_compartilhado/senha.ts'
import { criarServidor, registrar } from '../_compartilhado/servidor.ts'

Deno.serve(
  criarServidor(async (ctx) => {
    const { senha } = ctx.corpo
    if (typeof senha !== 'string') return { ok: false, codigo: 'CAMPOS_INVALIDOS' }
    if (validarForcaSenha(senha)) return { ok: false, codigo: 'SENHA_FRACA' }

    try {
      if (await senhaVazada(senha)) return { ok: false, codigo: 'SENHA_VAZADA' }
    } catch (e) {
      if (e instanceof VerificacaoIndisponivel) return { ok: false, codigo: 'VERIFICACAO_INDISPONIVEL' }
      throw e
    }

    const alvo = `usuario:${ctx.usuarioId}`
    const gravada = await ctx.servico.auth.admin.updateUserById(ctx.usuarioId, { password: senha })
    if (gravada.error) {
      await registrar(ctx, ctx.usuarioId, 'DEFINIR_SENHA', alvo, 'ERRO', 'ERRO_AUTH')
      return { ok: false, codigo: 'ERRO_INESPERADO' }
    }

    const { data } = await ctx.servico.rpc('sistema_confirmar_senha', { p_usuario: ctx.usuarioId })
    if (!data?.ok) {
      await registrar(ctx, ctx.usuarioId, 'DEFINIR_SENHA', alvo, 'NEGADO', 'NAO_ENCONTRADO')
      return { ok: false, codigo: 'NAO_ENCONTRADO' }
    }
    await registrar(ctx, ctx.usuarioId, 'DEFINIR_SENHA', alvo, 'OK')
    return { ok: true }
  }),
)
