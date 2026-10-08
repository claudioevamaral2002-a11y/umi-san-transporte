import { logErro } from '../_compartilhado/log.ts'
import { criarServidor, registrar } from '../_compartilhado/servidor.ts'

Deno.serve(
  criarServidor('convidar', async (ctx) => {
    const { email, nome, papel, empresa_id: empresa } = ctx.corpo
    if (typeof email !== 'string' || typeof nome !== 'string' || typeof papel !== 'string') {
      return { ok: false, codigo: 'CAMPOS_INVALIDOS' }
    }
    if (empresa !== undefined && empresa !== null && typeof empresa !== 'string') {
      return { ok: false, codigo: 'CAMPOS_INVALIDOS' }
    }
    if (!ctx.origem) return { ok: false, codigo: 'ERRO_INESPERADO' }

    // A RPC decide (permissão, aal2, limite, validações) com o JWT do ADM.
    const { data: preparo, error } = await ctx.usuario.rpc('preparar_convite', {
      p_email: email,
      p_nome: nome,
      p_papel: papel,
      p_empresa: empresa ?? null,
    })
    if (error) {
      logErro(ctx.funcao, 'preparar', error)
      return { ok: false, codigo: 'CAMPOS_INVALIDOS' }
    }
    if (!preparo?.ok) return { ok: false, codigo: String(preparo?.codigo ?? 'ERRO_INESPERADO') }

    const emailConvite = String(preparo.email)
    const alvo = `convite:${String(preparo.convite_id)}`
    const gerado = await ctx.servico.auth.admin.generateLink({
      type: 'invite',
      email: emailConvite,
      options: { redirectTo: `${ctx.origem}/definir-senha` },
    })
    const link = gerado.data?.properties?.action_link
    if (gerado.error || !link) {
      logErro(ctx.funcao, 'gerar-link', gerado.error ?? undefined)
      await registrar(ctx, ctx.usuarioId, 'CONVIDAR_LINK', alvo, 'ERRO', 'ERRO_AUTH')
      return { ok: false, codigo: 'ERRO_INESPERADO' }
    }
    await registrar(ctx, ctx.usuarioId, 'CONVIDAR_LINK', alvo, 'OK')
    return { ok: true, link }
  }),
)
