// Remove os fatores TOTP de um ADM ativo (perdeu o autenticador). Auditado em RESETAR_2FA.
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/resetar-2fa-adm.ts <email>
import { createClient } from '@supabase/supabase-js'
import { falhar, lerConfig, validarEmail } from './adm-comum.ts'

const email = validarEmail(process.argv[2])
const config = lerConfig(process.env)
if (!email) falhar('EMAIL_INVALIDO')
if (!config) falhar('CONFIG_AUSENTE')

const cliente = createClient(config.url, config.chave, {
  db: { schema: 'api' },
  auth: { persistSession: false, autoRefreshToken: false },
})

const alvo = await cliente.rpc('sistema_papel_por_email', { p_email: email })
if (alvo.error) falhar('ERRO_RPC')
if (!alvo.data?.ok) falhar('NAO_PERMITIDO') // não é ADM ativo (ou não existe): sem detalhes
const usuario = String(alvo.data.usuario_id)

async function registrar(resultado: 'OK' | 'ERRO', codigo: string | null) {
  const r = await cliente.rpc('sistema_registrar', {
    p_usuario: usuario,
    p_acao: 'RESETAR_2FA',
    p_alvo: 'adm',
    p_resultado: resultado,
    p_codigo: codigo,
  })
  if (r.error || !r.data?.ok) console.error('Aviso: falha ao registrar na auditoria')
}

const lista = await cliente.auth.admin.mfa.listFactors({ userId: usuario })
if (lista.error) {
  await registrar('ERRO', 'ERRO_AUTH')
  falhar('ERRO_AUTH')
}
const totp = (lista.data?.factors ?? []).filter((f) => f.factor_type === 'totp')
for (const fator of totp) {
  const apagado = await cliente.auth.admin.mfa.deleteFactor({ id: fator.id, userId: usuario })
  if (apagado.error) {
    await registrar('ERRO', 'ERRO_AUTH')
    falhar('ERRO_AUTH')
  }
}
await registrar('OK', null)
console.log(`OK: ${totp.length} fator(es) TOTP removido(s). No próximo login o ADM cadastra o 2FA de novo.`)
