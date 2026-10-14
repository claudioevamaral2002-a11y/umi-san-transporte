import { logErro } from '../_compartilhado/log.ts'
import { criarServidor } from '../_compartilhado/servidor.ts'
import { criarManipuladorEnderecos } from './google.ts'

// Fase 3A: busca de endereços (Places API New), detalhe do local e distância da rota (Routes API). A chave de servidor
// do Google fica só no segredo GOOGLE_MAPS_CHAVE_SERVIDOR; sem ela, devolve MAPAS_INDISPONIVEL e o app cai no texto
// livre. Cada chamada ao Google passa antes por api.registrar_uso_mapas, com o JWT de quem usa.
Deno.serve(
  criarServidor(
    'enderecos',
    async (ctx) => {
      const manipular = criarManipuladorEnderecos({
        chave: Deno.env.get('GOOGLE_MAPS_CHAVE_SERVIDOR') || null,
        buscar: fetch,
        log: (etapa, detalhe) => logErro(ctx.funcao, etapa, detalhe),
        registrarUso: async (tipo) => {
          const { data, error } = await ctx.usuario.rpc('registrar_uso_mapas', { p_tipo: tipo })
          if (error || !data) {
            logErro(ctx.funcao, 'registrar_uso', error)
            return { ok: false, codigo: 'ERRO_INESPERADO' }
          }
          return data as { ok: boolean; codigo?: string }
        },
      })
      return manipular(ctx.corpo)
    },
    // A busca acompanha a digitação; o limite de verdade (60/min por pessoa e teto da empresa) está no banco.
    { limitePorMinuto: 120 },
  ),
)
