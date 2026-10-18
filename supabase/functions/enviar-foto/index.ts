import { logErro } from '../_compartilhado/log.ts'
import { criarServidor } from '../_compartilhado/servidor.ts'
import { CORPO_MAX_BYTES, criarManipuladorFoto } from './foto.ts'

// Fase 3B: foto da conclusão do serviço. Autoriza e confirma com o JWT de quem envia (api.autorizar_foto /
// api.confirmar_foto) e grava no bucket privado `fotos` com a service role (não há política de escrita para usuários).
Deno.serve(
  criarServidor(
    'enviar-foto',
    async (ctx) => {
      const manipular = criarManipuladorFoto({
        autorizar: async (atividade, tipo, bytes) => {
          const { data, error } = await ctx.usuario.rpc('autorizar_foto', {
            p_atividade: atividade,
            p_tipo: tipo,
            p_bytes: bytes,
          })
          if (error || !data) {
            logErro(ctx.funcao, 'autorizar', error)
            return { ok: false, codigo: 'ERRO_INESPERADO' }
          }
          return data as { ok: boolean; codigo?: string }
        },
        gravar: async (caminho, bytes, tipo) => {
          const { error } = await ctx.servico.storage
            .from('fotos')
            .upload(caminho, bytes, { contentType: tipo, upsert: false, cacheControl: '3600' })
          if (error) logErro(ctx.funcao, 'upload', error)
          return !error
        },
        confirmar: async (foto) => {
          const { data, error } = await ctx.usuario.rpc('confirmar_foto', { p_foto: foto })
          if (error || !data) {
            logErro(ctx.funcao, 'confirmar', error)
            return { ok: false, codigo: 'ERRO_INESPERADO' }
          }
          return data as { ok: boolean; codigo?: string }
        },
        log: (etapa, detalhe) => logErro(ctx.funcao, etapa, detalhe),
      })
      return manipular(ctx.corpo)
    },
    // Até 10 fotos por serviço; o limite de verdade (30 por hora, 10 por pedido) está no banco.
    { limitePorMinuto: 20, limiteCorpoBytes: CORPO_MAX_BYTES },
  ),
)
