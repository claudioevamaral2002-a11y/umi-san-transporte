import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  CHAVE_PUBLICA,
  TOKEN_CAPTCHA_TESTE,
  URL_SUPABASE,
  cadastrarTotp,
  clientePublico,
  comBanco,
  criarPessoa,
  empresaNova,
  type Pessoa,
  type Resultado,
} from './ajuda.ts'

const ORIGEM_APP = 'http://127.0.0.1:8788'

async function chamar(
  funcao: string,
  token: string | null,
  corpo: unknown,
  extra: { metodo?: string; origem?: string; cabecalhos?: Record<string, string>; consulta?: string } = {},
): Promise<{ status: number; corpo: Resultado; cabecalhos: Headers }> {
  const semCorpo = extra.metodo === 'GET' || extra.metodo === 'HEAD'
  const resposta = await fetch(`${URL_SUPABASE}/functions/v1/${funcao}${extra.consulta ?? ''}`, {
    method: extra.metodo ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: CHAVE_PUBLICA,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extra.origem ? { Origin: extra.origem } : {}),
      ...extra.cabecalhos,
    },
    body: semCorpo ? undefined : JSON.stringify(corpo),
  })
  const texto = await resposta.text()
  let json: Resultado
  try {
    json = JSON.parse(texto) as Resultado
  } catch {
    json = { ok: false, codigo: `NAO_JSON:${resposta.status}` }
  }
  return { status: resposta.status, corpo: json, cabecalhos: resposta.headers }
}

const convidar = (quem: Pessoa, corpo: Record<string, unknown>) => chamar('convidar', quem.token, corpo)
const gerir = (quem: Pessoa, corpo: Record<string, unknown>) => chamar('gerir-usuario', quem.token, corpo)
const novoEmail = () => `convite-${randomUUID()}@teste.local`
const SENHA_FORTE = () => 'Forte-' + randomUUID()

const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const CODIGO_CURTO = new RegExp(`^[${ALFABETO}]{10}$`)
const LINK_CURTO = {
  exec: (link: string) => {
    const codigo = link.startsWith(`${ORIGEM_APP}/c/`) ? link.slice(`${ORIGEM_APP}/c/`.length) : ''
    return CODIGO_CURTO.test(codigo) ? ([link, codigo] as const) : null
  },
}

/** IP fictício e único por chamada de teste (o limite do resgate é por IP/dia). */
const ipNovo = () => `198.51.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

/** Código do link curto devolvido pelas funções (`${ORIGEM_APP}/c/<código>`). */
function codigoDe(link: unknown): string {
  expect(typeof link).toBe('string')
  const m = LINK_CURTO.exec(link as string)
  expect(m, `link fora do formato curto: ${String(link)}`).not.toBeNull()
  return m![1]!
}

/** "Continuar": POST resgatar-link com o código (como o front faz). */
const resgatar = (codigo: string, ip = ipNovo()) =>
  chamar('resgatar-link', null, { codigo }, { origem: ORIGEM_APP, cabecalhos: { 'cf-connecting-ip': ip, 'x-forwarded-for': ip } })

/** Abre o link curto como a pessoa: resgata (uso único) e monta a sessão com os tokens devolvidos. */
async function abrirLink(link: unknown) {
  const r = await resgatar(codigoDe(link))
  expect(r.corpo, JSON.stringify(r.corpo)).toMatchObject({ ok: true })
  expect(r.cabecalhos.get('cache-control')).toBe('no-store')
  const cliente = clientePublico()
  const { data, error } = await cliente.auth.setSession({
    access_token: r.corpo.access_token as string,
    refresh_token: r.corpo.refresh_token as string,
  })
  if (error || !data.session) throw error ?? new Error('setSession sem sessão')
  return { cliente, token: data.session.access_token, usuarioId: data.session.user.id }
}

const linkNoBanco = async (codigo: string) =>
  (
    await comBanco((db) =>
      db.query<{ usado_em: Date | null; tipo: string; token_hash: string }>(
        'select usado_em, tipo, token_hash from interno.links_acesso where codigo_hash = interno.hash_texto($1)',
        [codigo],
      ),
    )
  ).rows[0]

const metodosAmr = (token: string) =>
  ((JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { amr?: Array<{ method: string }> }).amr ?? []).map(
    (a) => a.method,
  )

const meuPerfil = async (cliente: ReturnType<typeof clientePublico>) => {
  const r = await cliente.rpc('meu_perfil')
  expect(r.error).toBeNull()
  return (r.data as Array<Record<string, unknown>>)[0]
}

describe('protocolo das funções', () => {
  it('só POST; exige Bearer válido; origem de navegador só a configurada', async () => {
    for (const funcao of ['definir-senha', 'convidar', 'gerir-usuario']) {
      expect((await chamar(funcao, null, {})).status, `${funcao} sem token`).toBe(401)
      expect((await chamar(funcao, 'lixo.sem.valor', {})).status, `${funcao} token inválido`).toBe(401)
      expect((await chamar(funcao, null, {}, { metodo: 'GET' })).status, `${funcao} GET`).toBe(405)

    }
  })

  it('origem não configurada é recusada mesmo com token válido', async () => {
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    const r = await chamar('definir-senha', cliente.token, { senha: 'Qualquer-Coisa-1' }, { origem: 'https://mau.example' })
    expect(r.status).toBe(403)
  })
})

describe('convidar', () => {
  it('não-ADM é negado com SEM_PERMISSAO e nada é criado', async () => {
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    const motorista = await criarPessoa({ papel: 'MOTORISTA' })
    const email = novoEmail()
    for (const quem of [cliente, motorista]) {
      const r = await convidar(quem, { email, nome: 'Convidado Teste', papel: 'MOTORISTA' })
      expect(r.status).toBe(200)
      expect(r.corpo).toMatchObject({ ok: false, codigo: 'SEM_PERMISSAO' })
      expect(r.corpo.link).toBeUndefined()
    }
    const existe = await comBanco((db) => db.query('select 1 from auth.users where email = $1', [email]))
    expect(existe.rowCount).toBe(0)
  })

  it('ADM convida; o link abre a sessão do novo usuário com o perfil certo; definir-senha libera o acesso', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const empresa = await empresaNova()
    const email = novoEmail()

    const r = await convidar(adm, { email, nome: 'Cliente Convidado', papel: 'CLIENTE', empresa_id: empresa })
    expect(r.corpo).toMatchObject({ ok: true })
    expect(typeof r.corpo.link).toBe('string')

    const novo = await abrirLink(r.corpo.link)
    expect(await meuPerfil(novo.cliente)).toMatchObject({
      nome: 'Cliente Convidado',
      papel: 'CLIENTE',
      empresa_id: empresa,
      ativo: true,
      senha_pendente: true,
    })
    // enquanto a senha está pendente o banco não entrega dados
    expect((await novo.cliente.from('empresas').select('id')).data).toEqual([])

    // diagnóstico: só os nomes dos métodos de autenticação (amr) que o verifyOtp do convite emite
    const amr = metodosAmr(novo.token)
    console.log('amr do link de convite (verifyOtp):', JSON.stringify(amr))
    expect(amr.some((m) => ['invite', 'recovery', 'otp', 'magiclink'].includes(m))).toBe(true)

    const fraca = await chamar('definir-senha', novo.token, { senha: 'curta1A' })
    expect((await chamar('definir-senha', novo.token, { senha: 'Aa1' + 'x'.repeat(80) })).corpo).toMatchObject({
      ok: false,
      codigo: 'SENHA_LONGA',
    })
    expect(fraca.corpo).toMatchObject({ ok: false, codigo: 'SENHA_FRACA' })
    for (const senha of ['tudominusculo123', 'TUDOMAIUSCULO123', 'SemNumeroNenhum']) {
      expect((await chamar('definir-senha', novo.token, { senha })).corpo, senha).toMatchObject({
        ok: false,
        codigo: 'SENHA_FRACA',
      })
    }
    expect((await chamar('definir-senha', novo.token, {})).corpo).toMatchObject({ ok: false, codigo: 'CAMPOS_INVALIDOS' })

    const vazada = await chamar('definir-senha', novo.token, { senha: 'Password123' })
    expect(vazada.corpo).toMatchObject({ ok: false, codigo: 'SENHA_VAZADA' })
    expect((await meuPerfil(novo.cliente))?.senha_pendente).toBe(true)

    const senha = `Forte-${randomUUID()}`
    const ok = await chamar('definir-senha', novo.token, { senha })
    expect(ok.corpo).toEqual({ ok: true })
    expect(await meuPerfil(novo.cliente)).toMatchObject({ senha_pendente: false })
    expect((await novo.cliente.from('empresas').select('id')).data).toHaveLength(1)

    // a senha nova entra de fato (login com captcha)
    const login = await clientePublico().auth.signInWithPassword({
      email,
      password: senha,
      options: { captchaToken: TOKEN_CAPTCHA_TESTE },
    })
    expect(login.error).toBeNull()
  })

  it('motorista convidado: depois da senha ainda precisa cadastrar o 2FA (aal1 até lá)', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const email = novoEmail()
    const senha = `Forte-${randomUUID()}`
    const r = await convidar(adm, { email, nome: 'Motorista Convidado', papel: 'MOTORISTA' })
    expect(r.corpo).toMatchObject({ ok: true })
    const novo = await abrirLink(r.corpo.link)
    expect(await meuPerfil(novo.cliente)).toMatchObject({ papel: 'MOTORISTA', senha_pendente: true, tem_2fa: false })

    expect((await chamar('definir-senha', novo.token, { senha })).corpo).toEqual({ ok: true })
    expect(await meuPerfil(novo.cliente)).toMatchObject({ senha_pendente: false, tem_2fa: false })

    // a troca de senha pela Admin API encerra a sessão do link: o front refaz o login com a senha nova e então cadastra o 2FA
    expect((await novo.cliente.auth.getUser()).error).not.toBeNull()
    const relogin = clientePublico()
    expect(
      (await relogin.auth.signInWithPassword({ email, password: senha, options: { captchaToken: TOKEN_CAPTCHA_TESTE } })).error,
    ).toBeNull()
    await cadastrarTotp(relogin)
    expect((await relogin.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel).toBe('aal2')
    expect(await meuPerfil(relogin)).toMatchObject({ tem_2fa: true })
  })

  it('e-mail que já tem conta é recusado pela RPC (sem link)', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const existente = await criarPessoa({ papel: 'CLIENTE' })
    const r = await convidar(adm, { email: existente.email, nome: 'Duplicado Teste', papel: 'MOTORISTA' })
    expect(r.corpo.ok).toBe(false)
    expect(r.corpo.link).toBeUndefined()
  })

  it('11º convite do dia é negado', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    for (let i = 1; i <= 10; i++) {
      const r = await convidar(adm, { email: novoEmail(), nome: 'Convidado Teste', papel: 'MOTORISTA' })
      expect(r.corpo, `convite ${i}`).toMatchObject({ ok: true })
    }
    const onze = await convidar(adm, { email: novoEmail(), nome: 'Convidado Teste', papel: 'MOTORISTA' })
    expect(onze.corpo).toMatchObject({ ok: false, codigo: 'LIMITE_EXCEDIDO' })
    expect(onze.corpo.link).toBeUndefined()
  })

  it('a operação fica auditada como sistema (CONVIDAR_LINK, sem o link)', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const r = await convidar(adm, { email: novoEmail(), nome: 'Convidado Teste', papel: 'MOTORISTA' })
    expect(r.corpo.ok).toBe(true)
    const linhas = await comBanco((db) =>
      db.query('select resultado, detalhe::text as detalhe from app.auditoria where usuario_id = $1 and acao = $2', [
        adm.id,
        'CONVIDAR_LINK',
      ]),
    )
    expect(linhas.rows).toHaveLength(1)
    expect(linhas.rows[0].resultado).toBe('OK')
    expect(linhas.rows[0].detalhe).toContain('sistema')
    expect(linhas.rows[0].detalhe).not.toContain(r.corpo.link as string)
  })
})

describe('links curtos: imunes a pré-visualização (WhatsApp, navegador, varredores)', () => {
  it('o link é curto, sem token do Auth; só o hash do código fica no banco', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const r = await convidar(adm, { email: novoEmail(), nome: 'Convidado Curto', papel: 'MOTORISTA' })
    expect(r.corpo).toMatchObject({ ok: true })
    const link = r.corpo.link as string
    const codigo = codigoDe(link)
    expect(link).not.toMatch(/token|verify|type=|redirect|supabase/)
    expect(link.length).toBeLessThan(45)
    const linha = await linkNoBanco(codigo)
    expect(linha).toMatchObject({ tipo: 'invite', usado_em: null })
    const emClaro = await comBanco((db) =>
      db.query('select 1 from interno.links_acesso where codigo_hash = $1 or token_hash = $1', [codigo]),
    )
    expect(emClaro.rowCount).toBe(0)
  })

  it('GET/HEAD (pré-carregamento, pré-visualização) não gastam o link; o resgate vale uma vez só', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const r = await convidar(adm, { email: novoEmail(), nome: 'Convidado Previa', papel: 'CLIENTE', empresa_id: await empresaNova() })
    const codigo = codigoDe(r.corpo.link)

    // o que um robô de pré-visualização faria com a função (a página do app é estática e não chama nada)
    expect((await chamar('resgatar-link', null, {}, { metodo: 'GET', consulta: `?codigo=${codigo}` })).status).toBe(405)
    expect((await chamar('resgatar-link', null, {}, { metodo: 'HEAD', consulta: `?codigo=${codigo}` })).status).toBe(405)
    expect((await linkNoBanco(codigo))?.usado_em).toBeNull()

    // o token do Auth continua válido: o resgate abre a sessão…
    const primeira = await abrirLink(r.corpo.link)
    expect(await meuPerfil(primeira.cliente)).toMatchObject({ nome: 'Convidado Previa', senha_pendente: true })
    expect((await linkNoBanco(codigo))?.usado_em).not.toBeNull()

    // …e só uma vez (no app e no Auth)
    expect((await resgatar(codigo)).corpo).toEqual({ ok: false, codigo: 'EXPIRADO' })
    const tokenHash = (await linkNoBanco(codigo))!.token_hash
    const direto = await clientePublico().auth.verifyOtp({ token_hash: tokenHash, type: 'invite' })
    expect(direto.error).not.toBeNull()
  })

  it('verifyOtp com o token_hash funciona uma vez e falha na segunda', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    const r = await gerir(adm, { acao: 'GERAR_LINK', usuario_id: cliente.id })
    const { token_hash: tokenHash, tipo } = (await linkNoBanco(codigoDe(r.corpo.link)))!
    expect(tipo).toBe('recovery')
    const uma = await clientePublico().auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
    expect(uma.error).toBeNull()
    expect(uma.data.session?.user.id).toBe(cliente.id)
    console.log('amr do verifyOtp(recovery) direto:', JSON.stringify(metodosAmr(uma.data.session!.access_token)))
    const duas = await clientePublico().auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
    expect(duas.error).not.toBeNull()
  })

  it('um link novo da mesma pessoa anula o anterior', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    const antigo = codigoDe((await gerir(adm, { acao: 'GERAR_LINK', usuario_id: cliente.id })).corpo.link)
    const novo = (await gerir(adm, { acao: 'GERAR_LINK', usuario_id: cliente.id })).corpo.link
    expect((await resgatar(antigo)).corpo).toEqual({ ok: false, codigo: 'EXPIRADO' })
    expect((await abrirLink(novo)).usuarioId).toBe(cliente.id)
  })

  it('código errado: NAO_ENCONTRADO; sem sessão e sem detalhes', async () => {
    for (const codigo of ['ZZZZZZZZZZ', 'curto', '', 'K7M2-QX9PRT']) {
      const r = await resgatar(codigo)
      expect(r.corpo, codigo).toEqual({ ok: false, codigo: 'NAO_ENCONTRADO' })
    }
    expect((await chamar('resgatar-link', null, 'não é objeto', { origem: ORIGEM_APP })).corpo).toMatchObject({ ok: false })
  })

  it('força bruta: 30 tentativas por IP/dia; a 31ª é recusada mesmo com código certo (sem gastar o link)', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    const codigo = codigoDe((await gerir(adm, { acao: 'GERAR_LINK', usuario_id: cliente.id })).corpo.link)
    const ip = ipNovo()
    // 30 tentativas já gastas hoje por este IP (direto no banco: o freio em memória barraria antes)
    await comBanco((db) =>
      db.query(
        `insert into interno.limites_ip (ip_hash, acao, janela_inicio, contagem)
         values (interno.hash_texto('ip:' || $1), 'RESGATAR_LINK',
                 date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo', 30)`,
        [ip],
      ),
    )
    expect((await resgatar(codigo, ip)).corpo).toEqual({ ok: false, codigo: 'LIMITE_EXCEDIDO' })
    expect((await linkNoBanco(codigo))?.usado_em).toBeNull()
    // outro IP segue normal
    expect((await resgatar(codigo, ipNovo())).corpo).toMatchObject({ ok: true })
  })

  it('freio em memória: rajada do mesmo IP é cortada antes do banco', async () => {
    const ip = ipNovo()
    const codigos: string[] = []
    for (let i = 0; i < 15; i++) codigos.push(String((await resgatar('ZZZZZZZZZZ', ip)).corpo.codigo))
    expect(codigos).toContain('LIMITE_EXCEDIDO')
  })

  it('protocolo: só POST; origem de navegador só a configurada', async () => {
    expect((await chamar('resgatar-link', null, {}, { metodo: 'GET' })).status).toBe(405)
    expect((await chamar('resgatar-link', null, { codigo: 'ZZZZZZZZZZ' }, { origem: 'https://mau.example' })).status).toBe(403)
  })

  it('o resgate fica auditado (origem sistema), sem o código nem o token', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    const codigo = codigoDe((await gerir(adm, { acao: 'GERAR_LINK', usuario_id: cliente.id })).corpo.link)
    await abrirLink(`${ORIGEM_APP}/c/${codigo}`)
    const linhas = await comBanco((db) =>
      db.query<{ acao: string; resultado: string; detalhe: string }>(
        "select acao, resultado, detalhe::text as detalhe from app.auditoria where usuario_id = $1 and acao in ('CRIAR_LINK_CURTO', 'RESGATAR_LINK')",
        [cliente.id],
      ),
    )
    expect(linhas.rows.map((l) => `${l.acao}:${l.resultado}`).sort()).toEqual(['CRIAR_LINK_CURTO:OK', 'RESGATAR_LINK:OK'])
    expect(linhas.rows.every((l) => l.detalhe.includes('sistema') && !l.detalhe.includes(codigo))).toBe(true)
  })
})

describe('definir-senha: porta de reautenticação', () => {
  it('login recente com senha (sem fator) é aceito', async () => {
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    const r = await chamar('definir-senha', cliente.token, { senha: SENHA_FORTE() })
    expect(r.corpo).toEqual({ ok: true })
  })

  it('motorista com 2FA: senha recente em aal1 exige reautenticação; em aal2 é aceito', async () => {
    const motorista = await criarPessoa({ papel: 'MOTORISTA' })
    const aal1 = clientePublico()
    const login = await aal1.auth.signInWithPassword({
      email: motorista.email,
      password: motorista.senha,
      options: { captchaToken: TOKEN_CAPTCHA_TESTE },
    })
    expect(login.error).toBeNull()
    const negado = await chamar('definir-senha', login.data.session!.access_token, { senha: SENHA_FORTE() })
    expect(negado.corpo).toMatchObject({ ok: false, codigo: 'REAUTENTICACAO_NECESSARIA' })

    const aceito = await chamar('definir-senha', motorista.token, { senha: SENHA_FORTE() })
    expect(aceito.corpo).toEqual({ ok: true })
  })

  it('usuário desativado é negado', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    expect(
      (await gerir(adm, { acao: 'DESATIVAR', usuario_id: cliente.id, motivo: 'teste de porta de senha' })).corpo,
    ).toEqual({ ok: true })
    const r = await chamar('definir-senha', cliente.token, { senha: SENHA_FORTE() })
    expect(r.corpo.ok).toBe(false)
    expect(['SEM_PERMISSAO', 'NAO_AUTENTICADO']).toContain(r.corpo.codigo)
    const login = await clientePublico().auth.signInWithPassword({
      email: cliente.email,
      password: cliente.senha,
      options: { captchaToken: TOKEN_CAPTCHA_TESTE },
    })
    expect(login.error).not.toBeNull()
  })
})

describe('gerir-usuario', () => {
  it('não-ADM é negado em todas as ações', async () => {
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    const alvo = await criarPessoa({ papel: 'CLIENTE' })
    for (const acao of ['GERAR_LINK', 'DESATIVAR', 'REATIVAR', 'RESETAR_2FA']) {
      const r = await gerir(cliente, { acao, usuario_id: alvo.id, motivo: 'tentativa indevida' })
      expect(r.corpo, acao).toMatchObject({ ok: false, codigo: 'SEM_PERMISSAO' })
    }
    // o alvo segue com a sessão renovável
    expect((await alvo.cliente.auth.refreshSession()).error).toBeNull()
  })

  it('entrada inválida é recusada sem tocar em nada', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    expect((await gerir(adm, { acao: 'APAGAR', usuario_id: adm.id })).corpo).toMatchObject({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect((await gerir(adm, { acao: 'GERAR_LINK', usuario_id: 'nao-e-uuid' })).corpo).toMatchObject({
      ok: false,
      codigo: 'CAMPOS_INVALIDOS',
    })
  })

  it('GERAR_LINK: gera recuperação para não-ADM; recusa ADM e o próprio ADM', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const outroAdm = await criarPessoa({ papel: 'ADM' })
    const cliente = await criarPessoa({ papel: 'CLIENTE' })

    const r = await gerir(adm, { acao: 'GERAR_LINK', usuario_id: cliente.id })
    expect(r.corpo).toMatchObject({ ok: true })
    const sessao = await abrirLink(r.corpo.link)
    expect(sessao.usuarioId).toBe(cliente.id)
    const amr = metodosAmr(sessao.token)
    console.log('amr do link de recuperação (verifyOtp):', JSON.stringify(amr))
    // a recuperação também passa pela porta de definir-senha (amr de link recente)
    expect((await chamar('definir-senha', sessao.token, { senha: SENHA_FORTE() })).corpo).toEqual({ ok: true })

    expect((await gerir(adm, { acao: 'GERAR_LINK', usuario_id: outroAdm.id })).corpo).toMatchObject({ ok: false, codigo: 'ALVO_ADM' })
    expect((await gerir(adm, { acao: 'GERAR_LINK', usuario_id: adm.id })).corpo).toMatchObject({
      ok: false,
      codigo: 'PROPRIO_USUARIO',
    })
    expect((await gerir(adm, { acao: 'GERAR_LINK', usuario_id: randomUUID() })).corpo).toMatchObject({
      ok: false,
      codigo: 'NAO_ENCONTRADO',
    })
  })

  it('DESATIVAR bloqueia a renovação da sessão e o acesso; REATIVAR devolve', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    expect((await cliente.cliente.from('empresas').select('id')).data).toHaveLength(1)

    const sem = await gerir(adm, { acao: 'DESATIVAR', usuario_id: cliente.id })
    expect(sem.corpo).toMatchObject({ ok: false, codigo: 'MOTIVO_OBRIGATORIO' })
    expect((await cliente.cliente.auth.refreshSession()).error).toBeNull()

    const off = await gerir(adm, { acao: 'DESATIVAR', usuario_id: cliente.id, motivo: 'teste de desativação' })
    expect(off.corpo).toEqual({ ok: true })
    expect((await cliente.cliente.auth.refreshSession()).error).not.toBeNull()
    expect((await cliente.cliente.from('empresas').select('id')).data).toEqual([])
    expect((await gerir(adm, { acao: 'DESATIVAR', usuario_id: adm.id, motivo: 'a mim mesmo' })).corpo).toMatchObject({
      ok: false,
      codigo: 'PROPRIO_USUARIO',
    })

    const on = await gerir(adm, { acao: 'REATIVAR', usuario_id: cliente.id, motivo: 'teste de reativação' })
    expect(on.corpo).toEqual({ ok: true })
    // a sessão antiga não é ressuscitada (o Auth a invalida no banimento); o acesso volta com um novo login
    const banido = await comBanco((db) => db.query('select banned_until from auth.users where id = $1', [cliente.id]))
    expect(banido.rows[0].banned_until).toBeNull()
    const volta = clientePublico()
    const login = await volta.auth.signInWithPassword({
      email: cliente.email,
      password: cliente.senha,
      options: { captchaToken: TOKEN_CAPTCHA_TESTE },
    })
    expect(login.error).toBeNull()
    expect((await volta.from('empresas').select('id')).data).toHaveLength(1)
  })

  it('RESETAR_2FA remove os fatores do motorista; recusa ADM; próximo acesso volta a aal1 sem fator', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const outroAdm = await criarPessoa({ papel: 'ADM' })
    const motorista = await criarPessoa({ papel: 'MOTORISTA' })
    const fatores = () =>
      comBanco((db) => db.query('select 1 from auth.mfa_factors where user_id = $1', [motorista.id])).then((r) => r.rowCount)
    expect(await fatores()).toBe(1)

    expect((await gerir(adm, { acao: 'RESETAR_2FA', usuario_id: outroAdm.id })).corpo).toMatchObject({
      ok: false,
      codigo: 'ALVO_ADM',
    })
    expect(await fatores()).toBe(1)

    expect((await gerir(adm, { acao: 'RESETAR_2FA', usuario_id: motorista.id })).corpo).toEqual({ ok: true })
    expect(await fatores()).toBe(0)

    const novoLogin = clientePublico()
    const login = await novoLogin.auth.signInWithPassword({
      email: motorista.email,
      password: motorista.senha,
      options: { captchaToken: TOKEN_CAPTCHA_TESTE },
    })
    expect(login.error).toBeNull()
    expect(await meuPerfil(novoLogin)).toMatchObject({ tem_2fa: false })
    expect((await novoLogin.auth.mfa.getAuthenticatorAssuranceLevel()).data).toMatchObject({
      currentLevel: 'aal1',
      nextLevel: 'aal1',
    })
  })

  it('as operações de Admin API ficam auditadas', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const motorista = await criarPessoa({ papel: 'MOTORISTA' })
    await gerir(adm, { acao: 'GERAR_LINK', usuario_id: motorista.id })
    await gerir(adm, { acao: 'RESETAR_2FA', usuario_id: motorista.id })
    await gerir(adm, { acao: 'DESATIVAR', usuario_id: motorista.id, motivo: 'auditoria de teste' })
    await gerir(adm, { acao: 'REATIVAR', usuario_id: motorista.id, motivo: 'auditoria de teste' })
    const linhas = await comBanco((db) =>
      db.query<{ acao: string; resultado: string; detalhe: string }>(
        "select acao, resultado, detalhe::text as detalhe from app.auditoria where usuario_id = $1 and detalhe->>'origem' = 'sistema'",
        [adm.id],
      ),
    )
    const acoes = linhas.rows.map((l) => l.acao).sort()
    expect(acoes).toEqual(['DESATIVAR_AUTH', 'GERAR_LINK', 'REATIVAR_AUTH', 'RESETAR_2FA'])
    expect(linhas.rows.every((l) => l.resultado === 'OK')).toBe(true)
    expect(linhas.rows.some((l) => l.detalhe.includes('access_token') || l.detalhe.includes('token='))).toBe(false)
  })
})
