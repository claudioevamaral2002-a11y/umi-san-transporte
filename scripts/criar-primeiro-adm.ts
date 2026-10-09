// Cria o convite do primeiro ADM (ou recupera o link de um ADM que ainda não definiu a senha).
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... GITHUB_STEP_SUMMARY=... node scripts/criar-primeiro-adm.ts <email> <nome>
// O link vai SOMENTE para o arquivo GITHUB_STEP_SUMMARY; nunca para stdout/stderr.
import { createClient } from '@supabase/supabase-js'
import { registrarLinkCurto } from '../supabase/functions/_compartilhado/links.ts'
import { escreverResumo, falhar, lerConfig, montarResumoLink, validarEmail, validarNome } from './adm-comum.ts'

const email = validarEmail(process.argv[2])
const nome = validarNome(process.argv[3])
const config = lerConfig(process.env)
if (!email) falhar('EMAIL_INVALIDO')
if (!nome) falhar('NOME_INVALIDO')
if (!config) falhar('CONFIG_AUSENTE')
if (!process.env.GITHUB_STEP_SUMMARY) falhar('SEM_RESUMO')

const cliente = createClient(config.url, config.chave, {
  db: { schema: 'api' },
  auth: { persistSession: false, autoRefreshToken: false },
})

let recuperacao = false
const convite = await cliente.rpc('sistema_convite_primeiro_adm', { p_email: email, p_nome: nome })
if (convite.error) falhar('ERRO_RPC')
if (!convite.data?.ok) {
  if (convite.data?.codigo !== 'JA_EXISTE_ADM') falhar(String(convite.data?.codigo ?? 'ERRO_RPC').slice(0, 60))
  const permitido = await cliente.rpc('sistema_link_primeiro_adm', { p_email: email })
  if (permitido.error) falhar('ERRO_RPC')
  if (!permitido.data?.ok) falhar('JA_EXISTE_ADM')
  recuperacao = true
}

const tipo = recuperacao ? 'recovery' : 'invite'
const gerado = await cliente.auth.admin.generateLink({
  type: tipo,
  email,
  options: { redirectTo: `${config.siteUrl}/definir-senha` },
})
// Link curto (/c/<código>): a pré-visualização do link não gasta o token; só o toque em "Continuar".
const curto = await registrarLinkCurto(cliente, gerado, tipo, config.siteUrl)
if (!curto.ok) falhar(curto.etapa === 'gerar' ? 'ERRO_AUTH' : 'ERRO_RPC')
const link = curto.link

const titulo = recuperacao ? 'Link de recuperação do primeiro ADM' : 'Convite do primeiro ADM'
if (!escreverResumo(process.env.GITHUB_STEP_SUMMARY, montarResumoLink({ titulo, email, link, recuperacao }))) {
  falhar('SEM_RESUMO')
}
console.log('OK: link gerado no resumo da execução.')
