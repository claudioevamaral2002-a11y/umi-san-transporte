import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CHAVE_PUBLICA, URL_SUPABASE, cadastrarTotp, comBanco, criarPessoa, rpc, type Pessoa, type Resultado } from './ajuda.ts'

const FAIXAS = [
  { antecedencia_min_horas: 48, multa_bp: 0 },
  { antecedencia_min_horas: 0, multa_bp: 5000 },
]

function parametrosValidos() {
  return {
    km_sem_reboque_cent: 450,
    km_com_reboque_cent: 650,
    taxa_fixa_reboque_cent: 15000,
    retorno_trecho_unico_bp: 5000,
    hora_espera_cent: 8000,
    hospedagem_diaria_cent: 25000,
    diaria_motorista_cent: 20000,
    faixas_cancelamento: FAIXAS,
    prazo_orcar_horas: 24,
    validade_orcamento_horas: 72,
    limiar_urgente_horas: 12,
    limite_saldo_negativo_cent: 100000,
    alerta_saldo_baixo_cent: 20000,
    retencao_fotos_dias: 365,
  }
}

const publicar = (quem: Pessoa) =>
  rpc(quem, 'publicar_parametros', {
    p: parametrosValidos(),
    p_vigente_desde: new Date(Date.now() + 5_000).toISOString(),
  })

const nomeEmpresa = () => `Empresa ${randomUUID().slice(0, 8)}`

interface LinhaAuditoria {
  acao: string
  codigo: string
  resultado: string
  usuario_id: string
}

/** Negações do usuário `alvo` vistas por um ADM (aal2) na auditoria. */
async function negacoes(adm: Pessoa, alvo: string, acao?: string): Promise<LinhaAuditoria[]> {
  const { data, error } = await adm.cliente.rpc('listar_auditoria', {
    p_usuario: alvo,
    p_resultado: 'NEGADO',
    p_acao: acao ?? null,
    p_limite: 100,
  })
  if (error) throw new Error(error.message)
  return data as LinhaAuditoria[]
}

const desligarDelegacoes = () => comBanco((db) => db.query('update app.permissoes_delegadas set ativo = false'))

type Tentativas = Array<[string, Promise<Resultado>]>

async function esperarSemPermissao(tentativas: Tentativas) {
  for (const [acao, promessa] of tentativas) {
    expect(await promessa, acao).toMatchObject({ ok: false, codigo: 'SEM_PERMISSAO' })
  }
}

describe('cliente não administra nada', () => {
  it('toda ação administrativa é negada com SEM_PERMISSAO e fica auditada como NEGADO', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    const intrusa = `Intrusa ${randomUUID()}`

    const tentativas: Tentativas = [
      ['PUBLICAR_PARAMETROS', publicar(cliente)],
      [
        'DEFINIR_PERMISSAO',
        rpc(cliente, 'definir_permissao', { p_chave: 'MOTORISTA_LANCA_RECARGA', p_ativo: true, p_motivo: 'tentativa' }),
      ],
      [
        'ALTERAR_PERFIL',
        rpc(cliente, 'alterar_perfil', { p_usuario: cliente.id, p_nome: 'Outro Nome', p_papel: 'ADM', p_empresa: null }),
      ],
      ['DEFINIR_ATIVO', rpc(cliente, 'definir_ativo', { p_usuario: adm.id, p_ativo: false, p_motivo: 'tentativa' })],
      ['SALVAR_EMPRESA', rpc(cliente, 'salvar_empresa', { p_id: null, p_nome: intrusa })],
      [
        'DEFINIR_LOGO_EMPRESA',
        rpc(cliente, 'definir_logo_empresa', { p_empresa: cliente.empresaId, p_caminho: `${cliente.empresaId}/logo.png` }),
      ],
      [
        'PREPARAR_CONVITE',
        rpc(cliente, 'preparar_convite', {
          p_email: `x-${randomUUID()}@teste.local`,
          p_nome: 'Fulano',
          p_papel: 'ADM',
          p_empresa: null,
        }),
      ],
      ['AUTORIZAR_OPERACAO_USUARIO', rpc(cliente, 'autorizar_operacao_usuario', { p_usuario: adm.id, p_acao: 'GERAR_LINK' })],
    ]
    await esperarSemPermissao(tentativas)

    // leituras administrativas voltam vazias
    expect((await cliente.cliente.rpc('listar_usuarios')).data).toEqual([])
    expect((await cliente.cliente.rpc('listar_auditoria')).data).toEqual([])

    // nada foi alterado
    const perfis = await comBanco((db) =>
      db.query<{ ativo: boolean }>('select ativo from app.perfis where usuario_id = any($1)', [[adm.id, cliente.id]]),
    )
    expect(perfis.rows.every((l) => l.ativo)).toBe(true)
    const criada = await comBanco((db) => db.query('select 1 from app.empresas where nome = $1', [intrusa]))
    expect(criada.rowCount).toBe(0)

    // cada negação aparece na auditoria com NEGADO e o código
    const lista = await negacoes(adm, cliente.id)
    for (const [acao] of tentativas) {
      const linha = lista.find((l) => l.acao === acao)
      expect(linha, `auditoria de ${acao}`).toBeDefined()
      expect(linha).toMatchObject({ resultado: 'NEGADO', codigo: 'SEM_PERMISSAO', usuario_id: cliente.id })
    }
  })

  it('cliente não lê usuários, auditoria, perfis nem convites pela API', async () => {
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    for (const tabela of ['usuarios', 'auditoria', 'perfis', 'convites']) {
      const r = await cliente.cliente.from(tabela).select('*')
      expect(r.error, tabela).not.toBeNull()
    }
  })
})

describe('delegação de parâmetros ao motorista', () => {
  it('motorista só publica com MOTORISTA_EDITA_PARAMETROS ligada; desligar volta a bloquear', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const motorista = await criarPessoa({ papel: 'MOTORISTA' })

    try {
      expect(await publicar(motorista)).toMatchObject({ ok: false, codigo: 'SEM_PERMISSAO' })

      expect(
        await rpc(adm, 'definir_permissao', {
          p_chave: 'MOTORISTA_EDITA_PARAMETROS',
          p_ativo: true,
          p_motivo: 'teste de delegação',
        }),
      ).toMatchObject({ ok: true })
      const publicada = await publicar(motorista)
      expect(publicada).toMatchObject({ ok: true })
      expect(typeof publicada.versao).toBe('number')

      expect(
        await rpc(adm, 'definir_permissao', {
          p_chave: 'MOTORISTA_EDITA_PARAMETROS',
          p_ativo: false,
          p_motivo: 'teste de revogação',
        }),
      ).toMatchObject({ ok: true })
      expect(await publicar(motorista)).toMatchObject({ ok: false, codigo: 'SEM_PERMISSAO' })
    } finally {
      await desligarDelegacoes()
    }

    const lista = await negacoes(adm, motorista.id, 'PUBLICAR_PARAMETROS')
    expect(lista).toHaveLength(2)
  })

  it('motorista nunca altera matriz nem usuários, mesmo com todas as delegações ligadas', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const motorista = await criarPessoa({ papel: 'MOTORISTA' })
    const alvo = await criarPessoa({ papel: 'CLIENTE' })
    const intrusa = `Intrusa ${randomUUID()}`

    try {
      await comBanco((db) => db.query('update app.permissoes_delegadas set ativo = true'))

      const tentativas: Tentativas = [
        [
          'DEFINIR_PERMISSAO',
          rpc(motorista, 'definir_permissao', { p_chave: 'MOTORISTA_LANCA_RECARGA', p_ativo: false, p_motivo: 'tentativa' }),
        ],
        [
          'PREPARAR_CONVITE',
          rpc(motorista, 'preparar_convite', {
            p_email: `x-${randomUUID()}@teste.local`,
            p_nome: 'Fulano',
            p_papel: 'MOTORISTA',
            p_empresa: null,
          }),
        ],
        [
          'ALTERAR_PERFIL',
          rpc(motorista, 'alterar_perfil', { p_usuario: alvo.id, p_nome: 'Outro Nome', p_papel: 'MOTORISTA', p_empresa: null }),
        ],
        ['DEFINIR_ATIVO', rpc(motorista, 'definir_ativo', { p_usuario: alvo.id, p_ativo: false, p_motivo: 'tentativa' })],
        ['SALVAR_EMPRESA', rpc(motorista, 'salvar_empresa', { p_id: null, p_nome: intrusa })],
      ]
      await esperarSemPermissao(tentativas)
      expect((await motorista.cliente.rpc('listar_usuarios')).data).toEqual([])
      expect((await motorista.cliente.rpc('listar_auditoria')).data).toEqual([])

      const lista = await negacoes(adm, motorista.id)
      for (const [acao] of tentativas) expect(lista.some((l) => l.acao === acao), acao).toBe(true)

      const perfil = await comBanco((db) => db.query('select ativo, papel from app.perfis where usuario_id = $1', [alvo.id]))
      expect(perfil.rows[0]).toMatchObject({ ativo: true, papel: 'CLIENTE' })
    } finally {
      await desligarDelegacoes()
    }
  })
})

describe('auditoria é imutável e fora da API de escrita', () => {
  it('escrita direta em app.* é recusada com 406; auditoria não existe em api; RPC inexistente falha', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const cliente = await criarPessoa({ papel: 'CLIENTE' })

    for (const quem of [adm, cliente]) {
      const escrever = async (metodo: string, sufixo = '') =>
        (
          await fetch(`${URL_SUPABASE}/rest/v1/auditoria${sufixo}`, {
            method: metodo,
            headers: {
              apikey: CHAVE_PUBLICA,
              Authorization: `Bearer ${quem.token}`,
              'Content-Type': 'application/json',
              'Content-Profile': 'app',
              'Accept-Profile': 'app',
            },
            body: metodo === 'DELETE' ? undefined : JSON.stringify({ acao: 'FORJADA', resultado: 'OK' }),
          })
        ).status
      expect(await escrever('POST'), `${quem.papel} POST`).toBe(406)
      expect(await escrever('PATCH', '?id=gt.0'), `${quem.papel} PATCH`).toBe(406)
      expect(await escrever('DELETE', '?id=gt.0'), `${quem.papel} DELETE`).toBe(406)

      const viaApi = await quem.cliente.from('auditoria').delete().gt('id', 0)
      expect(viaApi.error, `${quem.papel} api.auditoria`).not.toBeNull()

      for (const nome of ['editar_auditoria', 'apagar_auditoria']) {
        const r = await quem.cliente.rpc(nome, { p_id: 1 })
        expect(r.error, nome).not.toBeNull()
      }
    }

    // Nem o dono do banco altera/apaga sem desabilitar a trigger.
    await comBanco(async (db) => {
      await expect(db.query('update app.auditoria set acao = $1', ['ADULTERADA'])).rejects.toThrow(/imutável/)
      await expect(db.query('delete from app.auditoria')).rejects.toThrow(/imutável/)
    })
    const adulterada = await comBanco((db) =>
      db.query("select 1 from app.auditoria where acao in ('ADULTERADA', 'FORJADA')"),
    )
    expect(adulterada.rowCount).toBe(0)
  })
})

describe('isolamento entre clientes', () => {
  it('cliente A vê só o próprio perfil e a própria empresa, nunca os de B', async () => {
    const a = await criarPessoa({ papel: 'CLIENTE' })
    const b = await criarPessoa({ papel: 'CLIENTE' })

    const perfilA = await a.cliente.rpc('meu_perfil')
    expect(perfilA.error).toBeNull()
    expect(perfilA.data).toHaveLength(1)
    expect(perfilA.data[0]).toMatchObject({ papel: 'CLIENTE', empresa_id: a.empresaId, ativo: true, senha_pendente: false })

    const empresas = await a.cliente.from('empresas').select('id, nome')
    expect(empresas.error).toBeNull()
    expect(empresas.data?.map((e) => e.id)).toEqual([a.empresaId])

    expect((await a.cliente.rpc('listar_usuarios')).data).toEqual([])
    expect((await a.cliente.from('empresas').select('id').eq('id', b.empresaId!)).data).toEqual([])

    // pela tabela crua (schema app) também não: schema não exposto
    const crua = await fetch(`${URL_SUPABASE}/rest/v1/perfis?select=*`, {
      headers: { apikey: CHAVE_PUBLICA, Authorization: `Bearer ${a.token}`, 'Accept-Profile': 'app' },
    })
    expect(crua.status).toBe(406)
  })

  it('ADM enxerga o cliente; o cliente não enxerga ninguém nem vira outro papel', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    const vistos = (await adm.cliente.rpc('listar_usuarios')).data as Array<{ usuario_id: string }>
    expect(vistos.some((u) => u.usuario_id === cliente.id)).toBe(true)

    expect((await cliente.cliente.rpc('listar_usuarios')).data).toEqual([])
    expect(
      await rpc(cliente, 'alterar_perfil', {
        p_usuario: cliente.id,
        p_nome: 'Cliente Chefe',
        p_papel: 'ADM',
        p_empresa: null,
      }),
    ).toMatchObject({ ok: false, codigo: 'SEM_PERMISSAO' })
  })
})

describe('segundo fator (aal2)', () => {
  it('ADM em aal1 é recusado; com TOTP verificado é liberado', async () => {
    const outro = await criarPessoa({ papel: 'ADM' })
    const adm = await criarPessoa({ papel: 'ADM', mfa: false })

    const nivel = await adm.cliente.auth.mfa.getAuthenticatorAssuranceLevel()
    expect(nivel.data?.currentLevel).toBe('aal1')
    expect(await publicar(adm)).toMatchObject({ ok: false, codigo: 'SEM_PERMISSAO' })
    expect(await rpc(adm, 'salvar_empresa', { p_id: null, p_nome: nomeEmpresa() })).toMatchObject({
      ok: false,
      codigo: 'SEM_PERMISSAO',
    })
    expect((await adm.cliente.rpc('listar_usuarios')).data).toEqual([])
    // o perfil próprio continua legível para o front saber em que etapa está
    expect((await adm.cliente.rpc('meu_perfil')).data[0]).toMatchObject({ papel: 'ADM', tem_2fa: false })

    await cadastrarTotp(adm.cliente)
    const depois = await adm.cliente.auth.mfa.getAuthenticatorAssuranceLevel()
    expect(depois.data?.currentLevel).toBe('aal2')
    expect(await publicar(adm)).toMatchObject({ ok: true })
    expect(((await adm.cliente.rpc('listar_usuarios')).data as unknown[]).length).toBeGreaterThan(0)
    expect((await adm.cliente.rpc('meu_perfil')).data[0]).toMatchObject({ tem_2fa: true })

    // a negação em aal1 ficou auditada
    const lista = await negacoes(outro, adm.id)
    expect(lista.some((l) => l.acao === 'PUBLICAR_PARAMETROS' && l.codigo === 'SEM_PERMISSAO')).toBe(true)
  })

  it('motorista em aal1 é recusado mesmo com a delegação ligada; em aal2 é liberado', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const motorista = await criarPessoa({ papel: 'MOTORISTA', mfa: false })
    try {
      expect(
        await rpc(adm, 'definir_permissao', {
          p_chave: 'MOTORISTA_EDITA_PARAMETROS',
          p_ativo: true,
          p_motivo: 'teste de aal1',
        }),
      ).toMatchObject({ ok: true })
      expect(await publicar(motorista)).toMatchObject({ ok: false, codigo: 'SEM_PERMISSAO' })
      await cadastrarTotp(motorista.cliente)
      expect(await publicar(motorista)).toMatchObject({ ok: true })
    } finally {
      await desligarDelegacoes()
    }
  })

  it('cliente não precisa de segundo fator', async () => {
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    const nivel = await cliente.cliente.auth.mfa.getAuthenticatorAssuranceLevel()
    expect(nivel.data?.currentLevel).toBe('aal1')
    expect((await cliente.cliente.from('empresas').select('id')).data).toHaveLength(1)
  })
})

describe('desativação', () => {
  it('ADM desativado é recusado na chamada seguinte; reativar libera de novo', async () => {
    const principal = await criarPessoa({ papel: 'ADM' })
    const alvo = await criarPessoa({ papel: 'ADM' })

    expect(await rpc(alvo, 'salvar_empresa', { p_id: null, p_nome: nomeEmpresa() })).toMatchObject({ ok: true })

    expect(
      await rpc(principal, 'definir_ativo', { p_usuario: alvo.id, p_ativo: false, p_motivo: 'teste de desativação' }),
    ).toMatchObject({ ok: true })
    expect(await rpc(alvo, 'salvar_empresa', { p_id: null, p_nome: nomeEmpresa() })).toMatchObject({
      ok: false,
      codigo: 'SEM_PERMISSAO',
    })
    expect((await alvo.cliente.rpc('listar_usuarios')).data).toEqual([])
    expect((await alvo.cliente.rpc('meu_perfil')).data[0]).toMatchObject({ ativo: false })

    expect(
      await rpc(principal, 'definir_ativo', { p_usuario: alvo.id, p_ativo: true, p_motivo: 'teste de reativação' }),
    ).toMatchObject({ ok: true })
    expect(await rpc(alvo, 'salvar_empresa', { p_id: null, p_nome: nomeEmpresa() })).toMatchObject({ ok: true })

    expect(await negacoes(principal, alvo.id, 'SALVAR_EMPRESA')).toHaveLength(1)
  })

  it('cliente desativado deixa de enxergar a empresa', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    expect((await cliente.cliente.from('empresas').select('id')).data).toHaveLength(1)

    expect(
      await rpc(adm, 'definir_ativo', { p_usuario: cliente.id, p_ativo: false, p_motivo: 'teste de desativação' }),
    ).toMatchObject({ ok: true })
    expect((await cliente.cliente.from('empresas').select('id')).data).toEqual([])
    expect((await cliente.cliente.rpc('meu_perfil')).data[0]).toMatchObject({ ativo: false })
  })

  it('desativar exige motivo e o ADM não desativa a si mesmo', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const alvo = await criarPessoa({ papel: 'CLIENTE' })
    expect(await rpc(adm, 'definir_ativo', { p_usuario: alvo.id, p_ativo: false, p_motivo: ' ' })).toMatchObject({
      ok: false,
      codigo: 'MOTIVO_OBRIGATORIO',
    })
    expect(await rpc(adm, 'definir_ativo', { p_usuario: adm.id, p_ativo: false, p_motivo: 'tentativa própria' })).toMatchObject({
      ok: false,
    })
  })
})

describe('senha trocada por fora (Adendo A3)', () => {
  it('após auth.updateUser a próxima RPC é recusada até a senha ser confirmada pelo sistema', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    expect(await rpc(adm, 'salvar_empresa', { p_id: null, p_nome: nomeEmpresa() })).toMatchObject({ ok: true })

    const troca = await adm.cliente.auth.updateUser({ password: 'NovaSenha-123x' })
    expect(troca.error).toBeNull()

    const depois = await rpc(adm, 'salvar_empresa', { p_id: null, p_nome: nomeEmpresa() })
    expect(depois.ok).toBe(false)
    expect(depois.codigo).toBe('SEM_PERMISSAO')
    expect((await adm.cliente.rpc('meu_perfil')).data[0]).toMatchObject({ senha_pendente: true })

    // simula a confirmação feita pela Edge Function definir-senha
    await comBanco((db) => db.query('update app.perfis set senha_pendente = false where usuario_id = $1', [adm.id]))
    expect(await rpc(adm, 'salvar_empresa', { p_id: null, p_nome: nomeEmpresa() })).toMatchObject({ ok: true })
  })

  it('cliente que troca a senha por fora perde o acesso aos dados', async () => {
    const cliente = await criarPessoa({ papel: 'CLIENTE' })
    expect((await cliente.cliente.from('empresas').select('id')).data).toHaveLength(1)
    expect((await cliente.cliente.auth.updateUser({ password: 'NovaSenha-123x' })).error).toBeNull()
    expect((await cliente.cliente.from('empresas').select('id')).data).toEqual([])
  })
})

describe('limite de convites e auditoria', () => {
  it('11º convite no dia é recusado (LIMITE_EXCEDIDO) e auditado como NEGADO', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const convidar = () =>
      rpc(adm, 'preparar_convite', {
        p_email: `convite-${randomUUID()}@teste.local`,
        p_nome: 'Convidado Teste',
        p_papel: 'MOTORISTA',
        p_empresa: null,
      })
    for (let i = 1; i <= 10; i++) expect(await convidar(), `convite ${i}`).toMatchObject({ ok: true })
    expect(await convidar()).toMatchObject({ ok: false, codigo: 'LIMITE_EXCEDIDO' })

    const lista = await negacoes(adm, adm.id, 'PREPARAR_CONVITE')
    expect(lista).toHaveLength(1)
    expect(lista[0]).toMatchObject({ codigo: 'LIMITE_EXCEDIDO', resultado: 'NEGADO' })
  })

  it('apenas ADM lê a auditoria; o filtro por resultado separa NEGADO de OK', async () => {
    const adm = await criarPessoa({ papel: 'ADM' })
    const motorista = await criarPessoa({ papel: 'MOTORISTA' })
    expect(await rpc(motorista, 'salvar_empresa', { p_id: null, p_nome: nomeEmpresa() })).toMatchObject({ ok: false })

    expect((await motorista.cliente.rpc('listar_auditoria', { p_usuario: motorista.id })).data).toEqual([])
    const vistas = await negacoes(adm, motorista.id)
    expect(vistas.length).toBeGreaterThan(0)
    expect(vistas.every((l) => l.resultado === 'NEGADO' && l.usuario_id === motorista.id)).toBe(true)

    const ok = await adm.cliente.rpc('listar_auditoria', { p_usuario: adm.id, p_resultado: 'OK' })
    expect(ok.error).toBeNull()
    expect((ok.data as LinhaAuditoria[]).every((l) => l.resultado === 'OK')).toBe(true)
  })
})
