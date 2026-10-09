import { registrarLinkCurto } from '../_compartilhado/links.ts'
import { logErro } from '../_compartilhado/log.ts'
import { criarServidor, registrar } from '../_compartilhado/servidor.ts'

Deno.serve(
  criarServidor('convidar', async (ctx) => {
    const { email, nome, papel, empresa_id: empresa, nivel } = ctx.corpo
    if (typeof email !== 'string' || typeof nome !== 'string' || typeof papel !== 'string') {
      return { ok: false, codigo: 'CAMPOS_INVALIDOS' }
    }
    if (empresa !== undefined && empresa !== null && typeof empresa !== 'string') {
      return { ok: false, codigo: 'CAMPOS_INVALIDOS' }
    }
    // Nível do cliente (1 gestor da empresa, 2 solicitante, 3 visualizador): só a forma é conferida aqui.
    if (nivel !== undefined && nivel !== null && !(typeof nivel === 'number' && Number.isInteger(nivel))) {
      return { ok: false, codigo: 'CAMPOS_INVALIDOS' }
    }
    if (!ctx.origem) return { ok: false, codigo: 'ERRO_INESPERADO' }

    // A RPC decide tudo com o JWT de quem chama (ADM ou gestor da empresa N1): permissão, aal2, empresa
    // forçada para o N1, nível, limite e validações. Esta função não tem regra de papel própria.
    const { data: preparo, error } = await ctx.usuario.rpc('preparar_convite', {
      p_email: email,
      p_nome: nome,
      p_papel: papel,
      p_empresa: empresa ?? null,
      p_nivel: nivel ?? null,
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
    // Link curto (/c/<código>): só o toque em "Continuar" gasta o token (pré-visualizações não).
    const curto = await registrarLinkCurto(ctx.servico, gerado, 'invite', ctx.origem)
    if (!curto.ok) {
      logErro(ctx.funcao, `link-${curto.etapa}`, gerado.error ?? undefined)
      await registrar(ctx, ctx.usuarioId, 'CONVIDAR_LINK', alvo, 'ERRO', 'ERRO_AUTH')
      return { ok: false, codigo: 'ERRO_INESPERADO' }
    }
    await registrar(ctx, ctx.usuarioId, 'CONVIDAR_LINK', alvo, 'OK')
    return { ok: true, link: curto.link }
  }),
)
