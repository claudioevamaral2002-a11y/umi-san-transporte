import { senhaVazada, VerificacaoIndisponivel } from '../_compartilhado/hibp.ts'
import { logErro } from '../_compartilhado/log.ts'
import { normalizarSenha, validarForcaSenha } from '../_compartilhado/senha.ts'
import { criarServidor, registrar } from '../_compartilhado/servidor.ts'

Deno.serve(
  criarServidor('definir-senha', async (ctx) => {
    if (typeof ctx.corpo.senha !== 'string') return { ok: false, codigo: 'CAMPOS_INVALIDOS' }
    const senha = normalizarSenha(ctx.corpo.senha)
    const recusa = validarForcaSenha(senha)
    if (recusa) return { ok: false, codigo: recusa }

    // Porta no banco com o JWT do chamador: link recente ou reautenticação (e aal2 se houver fator).
    const { data: porta, error: erroPorta } = await ctx.usuario.rpc('autorizar_definir_senha')
    if (erroPorta) {
      logErro(ctx.funcao, 'porta', erroPorta)
      return { ok: false, codigo: 'ERRO_INESPERADO' }
    }
    if (!porta?.ok) return { ok: false, codigo: String(porta?.codigo ?? 'ERRO_INESPERADO') }

    try {
      if (await senhaVazada(senha)) return { ok: false, codigo: 'SENHA_VAZADA' }
    } catch (e) {
      if (e instanceof VerificacaoIndisponivel) {
        logErro(ctx.funcao, 'hibp')
        return { ok: false, codigo: 'VERIFICACAO_INDISPONIVEL' }
      }
      throw e
    }

    const alvo = `usuario:${ctx.usuarioId}`
    const gravada = await ctx.servico.auth.admin.updateUserById(ctx.usuarioId, { password: senha })
    if (gravada.error) {
      logErro(ctx.funcao, 'gravar', gravada.error)
      if (gravada.error.code === 'weak_password') {
        await registrar(ctx, ctx.usuarioId, 'DEFINIR_SENHA', alvo, 'NEGADO', 'SENHA_FRACA')
        return { ok: false, codigo: 'SENHA_FRACA' }
      }
      await registrar(ctx, ctx.usuarioId, 'DEFINIR_SENHA', alvo, 'ERRO', 'ERRO_AUTH')
      return { ok: false, codigo: 'ERRO_INESPERADO' }
    }

    const { data, error } = await ctx.servico.rpc('sistema_confirmar_senha', { p_usuario: ctx.usuarioId })
    if (error || !data?.ok) {
      if (error) logErro(ctx.funcao, 'confirmar', error)
      await registrar(ctx, ctx.usuarioId, 'DEFINIR_SENHA', alvo, 'NEGADO', 'NAO_ENCONTRADO')
      return { ok: false, codigo: 'NAO_ENCONTRADO' }
    }
    await registrar(ctx, ctx.usuarioId, 'DEFINIR_SENHA', alvo, 'OK')
    return { ok: true }
  }),
)
