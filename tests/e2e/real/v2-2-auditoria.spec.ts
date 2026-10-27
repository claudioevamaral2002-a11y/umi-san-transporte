import { randomInt, randomUUID } from 'node:crypto'
import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { simularBlocosDoMapa, simularMapas } from '../apoio/mapasFalsos.ts'
import { comBanco, criarPessoa, empresaComContrato, entrarComDoisFatores, entrarComSenha, rpc } from './apoio.ts'

// v2.2 (Tarefa 7) contra o Supabase real do CI (projeto Playwright `real`, um worker), pelas telas do app novo
// (dist-novo, :8789): as correções da auditoria externa que dependem do banco de verdade.
//   1. O Master põe "Até quantas pessoas" = 4 na IVO Passageiros (lápis de Categorias e preços).
//   2. O banco recusa 5 pessoas (ACIMA_DA_CAPACIDADE); o N2 tenta passar de 4 na tela (o "+" para em 4) e pede com 4.
//   3. O motorista aceita pela tabela, o N2 confirma (reserva no saldo) e depois cancela com 24 h ou mais de antecedência
//      (sem multa): o detalhe mostra "Cancelada sem cobrança · reserva de R$ X devolvida" e a lista, "Sem cobrança".
//   4. Um pedido concluído hoje aparece na agenda do dia do N2 como cartão cinza "Concluída".
// Só o Google é simulado. O motorista atende os pedidos novos (o ativo mais antigo) só durante o teste e é desativado no
// fim; a empresa e as pessoas são criadas aqui. A IVO Passageiros (global) começa sem limite e volta a 4 no fim, que é o
// valor da migration. Atalhos no banco: as datas do pedido (para o cancelamento sem multa e para a saída) e o pedido
// concluído da agenda, que vai todo pelas RPCs (a tela da viagem é coberta em fase-4-1 e estilo-uber).

const URL_NOVO = 'http://127.0.0.1:8789'
/** Km da rota simulada (`simularMapas`). */
const KM_ROTA = 38.2

/** "R$ 164,60" como a tela escreve (o espaço depois do R$ pode ser inseparável), com o milhar. */
const brl = (cent: number) => {
  const reais = Math.floor(cent / 100).toLocaleString('pt-BR')
  return `R\\$\\s${reais.replace('.', '\\.')},${String(cent % 100).padStart(2, '0')}`
}
/** Forma curta ("R$ 360" sem os centavos zerados; "R$ 164,60" com eles). */
const curto = (cent: number) =>
  cent % 100 === 0 ? `R\\$\\s${(cent / 100).toLocaleString('pt-BR').replace('.', '\\.')}(?![\\d,])` : brl(cent)
const numeroPedido = (n: number) => `#${String(n).padStart(4, '0')}`

/** Placa no padrão Mercosul, única por execução (o banco tem índice único). */
function placaNova(): string {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const l = () => letras[randomInt(letras.length)]!
  return `${l()}${l()}${l()}${randomInt(10)}${l()}${randomInt(10)}${randomInt(10)}`
}

/** Espera o elemento; se o evento em tempo real não chegar, relê a página (a tela também se atualiza pela releitura). */
async function veComRecarga(page: Page, alvo: Locator, ms = 25_000) {
  try {
    await expect(alvo).toBeVisible({ timeout: ms })
  } catch {
    test.info().annotations.push({ type: 'aviso', description: 'evento em tempo real não chegou; página relida' })
    await page.reload()
    await expect(alvo).toBeVisible({ timeout: 30_000 })
  }
}

/** Escolhe a opção `opcao` no campo de endereço `nome` (digitando `texto`). */
async function escolher(page: Page, nome: string, texto: string, opcao: RegExp) {
  await page.getByRole('combobox', { name: nome, exact: true }).fill(texto)
  await page.getByRole('option', { name: opcao }).first().click()
}

/** A chamada chega ao motorista (abre sozinha; se o evento falhar, ele abre pela URL). */
async function abrirChamada(pm: Page, id: string) {
  const abriuSozinha = await pm.waitForURL(new RegExp(`/chamada/${id}$`), { timeout: 20_000 }).then(
    () => true,
    () => false,
  )
  if (!abriuSozinha) {
    test.info().annotations.push({ type: 'aviso', description: 'chamada não abriu sozinha; aberta pela URL' })
    await pm.goto(`/chamada/${id}`)
  }
}

/**
 * Leva o início do pedido para `agora + intervalo` (minuto cheio); o bloco da agenda anda junto, com a mesma duração, e
 * `prazo_orcar_ate` desce junto (constraint atividades_prazo). O mesmo atalho de fase-4-1 e v2-1-faturas.
 */
async function moverInicio(id: string, intervalo: string) {
  await comBanco((db) =>
    db.query(
      `with novo as (select date_trunc('minute', now()) + $2::interval as t),
            a as (update app.atividades x set inicio = (select t from novo),
                         prazo_orcar_ate = least(x.prazo_orcar_ate, (select t from novo))
                   where x.id = $1 returning x.inicio)
       update app.agenda_blocos b set periodo = tstzrange(
                (select t from novo), (select t from novo) + (upper(b.periodo) - lower(b.periodo)), '[)')
        where b.atividade_id = $1 and b.ativo`,
      [id, intervalo],
    ),
  )
}

/** Lançamentos de um pedido, na ordem ("RESERVA:12345"). */
const lancamentosDe = (id: string) =>
  comBanco(async (db) =>
    (await db.query<{ tipo: string; valor: string }>('select tipo, valor_cent as valor from app.lancamentos where atividade_id = $1 order by id', [id])).rows.map(
      (l) => `${l.tipo}:${l.valor}`,
    ),
  )

const pessoasMaxPassageiros = () =>
  comBanco(
    async (db) =>
      (await db.query<{ v: number | null }>(`select pessoas_max as v from app.categorias where codigo = 'PASSAGEIROS'`)).rows[0]!.v,
  )

/** Pedido por categoria (o mesmo formato da tela), daqui a `horas` horas no minuto cheio. */
function pedidoPassageiros(horas: number, pessoas: number) {
  const inicio = new Date(Date.now() + horas * 3_600_000)
  inicio.setUTCSeconds(0, 0)
  return {
    inicio: inicio.toISOString(),
    duracao_min: 60,
    origem: 'Porto de Itajaí',
    destino: 'Marina Itajaí, rampa 2',
    destino_lat: -26.9,
    destino_lng: -48.66,
    levar: true,
    trazer: false,
    carga: 'PESSOAS',
    pessoas_qtd: pessoas,
    modalidade: 'VEICULO_PROPRIO',
    reboque: 'NAO',
    categoria: 'PASSAGEIROS',
  }
}

test.describe('correções da auditoria (v2.2)', () => {
  test.setTimeout(600_000)
  let motoristaDoTeste: string | null = null
  test.afterEach(async () => {
    // A IVO Passageiros volta ao valor da migration (4), mesmo se o teste parar antes do Master salvar.
    await comBanco((db) => db.query(`update app.categorias set pessoas_max = 4 where codigo = 'PASSAGEIROS'`))
    if (motoristaDoTeste) {
      const id = motoristaDoTeste
      await comBanco((db) => db.query(`update app.perfis set ativo = false where usuario_id = $1`, [id]))
    }
  })

  test('limite de 4 pessoas → pedido com 4 → orçado, confirmado e cancelado sem cobrança → concluída na agenda', async ({ browser }) => {
    const motorista = await criarPessoa({ papel: 'MOTORISTA', nome: 'Mauro Auditoria' })
    await comBanco((db) =>
      db.query(`update app.perfis set criado_em = now() - interval '40 years' where usuario_id = $1`, [motorista.id]),
    )
    motoristaDoTeste = motorista.id
    expect(
      await rpc(motorista, 'salvar_veiculo', {
        p: { modelo: 'Spin', cor: 'prata', placa: placaNova(), lugares: 6, carga_max_kg: 300, reboque_desc: null, categorias: ['PASSAGEIROS'] },
      }),
    ).toMatchObject({ ok: true })
    const adm = await criarPessoa({ papel: 'ADM' })
    const empresa = await empresaComContrato()
    const solicitante = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 2, nome: 'Sara Auditoria' })
    expect(
      await rpc(adm, 'lancar_recarga', { p_empresa: empresa, p_valor_cent: 100000, p_motivo: 'Pix', p_comprovante: null, p_chave: randomUUID() }),
    ).toMatchObject({ ok: true })
    // A Passageiros começa sem limite: o número 4 vem do Master, pela tela.
    await comBanco((db) => db.query(`update app.categorias set pessoas_max = null where codigo = 'PASSAGEIROS'`))

    const novoContexto = (extra: Parameters<typeof browser.newContext>[0] = {}) =>
      browser.newContext({ ...devices['Pixel 7'], baseURL: URL_NOVO, ...extra })
    const ctxAdm = await novoContexto()
    const ctxMot = await novoContexto({
      geolocation: { latitude: -26.91, longitude: -48.67, accuracy: 10 },
      permissions: ['geolocation'],
    })
    const ctxCli = await novoContexto()
    try {
      // ===== 1. O Master põe "Até quantas pessoas" = 4 no lápis da IVO Passageiros.
      const pa = await ctxAdm.newPage()
      await entrarComDoisFatores(pa, adm.email, adm.senha, adm.segredoTotp!)
      await pa.goto('/adm/categorias')
      await expect(pa.getByRole('heading', { name: 'Categorias e preços', level: 1 })).toBeVisible({ timeout: 30_000 })
      const cartaoPassageiros = pa.getByRole('region', { name: 'IVO Passageiros', exact: true })
      await expect(cartaoPassageiros.getByTestId('pessoas-max')).toHaveCount(0, { timeout: 30_000 })
      await cartaoPassageiros.getByRole('button', { name: 'Editar IVO Passageiros', exact: true }).click()
      const campoPessoas = cartaoPassageiros.getByLabel('Até quantas pessoas', { exact: true })
      await expect(campoPessoas).toHaveValue('')
      await campoPessoas.fill('4')
      await cartaoPassageiros.getByRole('button', { name: 'Salvar categoria' }).click()
      await expect(pa.getByText('IVO Passageiros salva.')).toBeVisible({ timeout: 30_000 })
      expect(await pessoasMaxPassageiros()).toBe(4)

      // ===== 2. O banco recusa 5 pessoas (mesmo vindo de um app desatualizado) e devolve o limite.
      expect(await rpc(solicitante, 'criar_pedido', { p: pedidoPassageiros(72, 5) })).toEqual({
        ok: false,
        codigo: 'ACIMA_DA_CAPACIDADE',
        pessoas_max: 4,
      })
      const previa = await rpc(solicitante, 'categorias_disponiveis', { p: { km: KM_ROTA, levar: true, trazer: false } })
      const passageiros = (previa.categorias as Array<{ codigo: string; disponivel: boolean; total_cent: number; pessoas_max: number | null }>).find(
        (c) => c.codigo === 'PASSAGEIROS',
      )!
      expect(passageiros).toMatchObject({ disponivel: true, pessoas_max: 4 })
      const TOTAL = passageiros.total_cent
      expect(TOTAL).toBeGreaterThan(0)

      // ===== 3. O N2 tenta passar de 4 na tela: o "+" para em 4, com "até 4 pessoas"; pede com 4.
      const pm = await ctxMot.newPage()
      await simularMapas(pm, { rota: { km: KM_ROTA, minutos: 45 } })
      await simularBlocosDoMapa(pm)
      await entrarComDoisFatores(pm, motorista.email, motorista.senha, motorista.segredoTotp!)
      await pm.goto('/')

      const pc = await ctxCli.newPage()
      await simularMapas(pc, { rota: { km: KM_ROTA, minutos: 45 } })
      await simularBlocosDoMapa(pc)
      await entrarComSenha(pc, solicitante.email, solicitante.senha)
      await expect(pc.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Sara$/ })).toBeVisible({ timeout: 30_000 })
      await escolher(pc, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
      await escolher(pc, 'Para', 'Porto', /Porto de Itajaí/)
      const radioPassageiros = pc.getByRole('radiogroup', { name: 'Categorias' }).getByRole('radio', { name: /IVO Passageiros/ })
      await expect(radioPassageiros).toBeEnabled({ timeout: 30_000 })
      await radioPassageiros.click()
      await pc.getByText('Detalhes da corrida (pessoas, carga, contato)').click()
      const pessoas = pc.getByRole('group', { name: 'Pessoas' })
      await expect(pessoas).toContainText('até 4 pessoas')
      const mais = pc.getByRole('button', { name: 'Aumentar pessoas' })
      for (let i = 0; i < 3; i++) await mais.click()
      await expect(pessoas.locator('output')).toHaveText('4')
      await expect(mais).toBeDisabled()
      const pedir = pc.getByRole('button', { name: /^Pedir IVO Passageiros · / })
      await expect(pedir).toBeEnabled({ timeout: 30_000 })
      await pedir.click()
      await expect(pc).toHaveURL(/\/corrida\/[0-9a-f-]{36}$/, { timeout: 30_000 })
      const id = new URL(pc.url()).pathname.split('/').pop()!
      await expect(pc.getByRole('heading', { name: 'Enviado ao Ivo' })).toBeVisible({ timeout: 20_000 })
      const pedido = await rpc(solicitante, 'pedido', { p_id: id })
      expect(pedido).toMatchObject({ pedido: { status: 'SOLICITADA', categoria: 'PASSAGEIROS', pessoas_qtd: 4 } })
      const numero = (pedido.pedido as { numero: number }).numero
      // v2.2: o número do pedido no topo da corrida.
      await expect(pc.getByTestId('numero-pedido')).toHaveText(`Pedido ${numeroPedido(numero)}`)

      // ===== 4. O motorista aceita pela tabela; o N2 confirma (o valor fica reservado no saldo).
      await abrirChamada(pm, id)
      await expect(pm.getByTestId('valor-tabela')).toHaveText(new RegExp(`^${brl(TOTAL)}$`), { timeout: 40_000 })
      await pm.getByRole('button', { name: new RegExp(`^Aceitar por ${curto(TOTAL)}$`) }).click()
      await expect(pm.getByText(/^Proposta enviada\./)).toBeVisible({ timeout: 30_000 })
      expect(await rpc(solicitante, 'pedido', { p_id: id })).toMatchObject({ pedido: { status: 'ORCADA' }, orcamento: { total_cent: TOTAL } })

      const confirmar = pc.getByRole('button', { name: new RegExp(`^Confirmar corrida · ${curto(TOTAL)}$`) })
      await veComRecarga(pc, confirmar)
      await confirmar.click()
      await expect(pc.getByRole('heading', { name: 'Corrida confirmada' })).toBeVisible({ timeout: 30_000 })
      expect(await rpc(solicitante, 'pedido', { p_id: id })).toMatchObject({ pedido: { status: 'AGENDADA' } })
      expect(await lancamentosDe(id)).toEqual([`RESERVA:${TOTAL}`])

      // ===== 5. O N2 cancela com 3 dias de antecedência (faixa de 24 h ou mais: sem multa), na tela nova da corrida.
      await moverInicio(id, '3 days')
      await pc.reload()
      await pc.getByRole('button', { name: 'Cancelar agendamento' }).click({ timeout: 30_000 })
      const folha = pc.getByRole('dialog', { name: 'Cancelar agendamento' })
      await expect(folha.getByTestId('previa-multa')).toContainText('sem multa', { timeout: 30_000 })
      await folha.getByRole('button', { name: 'Confirmar cancelamento' }).click()
      await expect(folha).toBeHidden({ timeout: 30_000 })
      await expect(pc.getByRole('heading', { level: 1 })).toHaveText(
        new RegExp(`^Cancelada sem cobrança · reserva de ${brl(TOTAL)} devolvida$`),
        { timeout: 30_000 },
      )
      await expect(pc.getByRole('region', { name: 'Orçamento (não cobrado)' })).toBeVisible()
      await expect(pc.getByTestId('folha-mapa')).not.toContainText('Se precisar cancelar depois')
      // O banco: reserva devolvida, nenhuma multa, nenhum débito.
      expect(await lancamentosDe(id)).toEqual([`RESERVA:${TOTAL}`, `LIBERACAO_RESERVA:${TOTAL}`])
      expect(await rpc(solicitante, 'pedido', { p_id: id })).toMatchObject({
        pedido: { status: 'CANCELADA' },
        cobranca: { debito_cent: null, multa_cent: null, liberado_cent: TOTAL },
      })

      // A lista de encerrados mostra "Sem cobrança" no lugar do orçamento.
      await pc.goto('/pedidos?filtro=encerrados')
      const cartao = pc.getByTestId('lista-pedidos').getByRole('link').filter({ hasText: `Pedido ${numeroPedido(numero)}` })
      await expect(cartao).toBeVisible({ timeout: 30_000 })
      await expect(cartao.getByTestId('cobranca-pedido')).toHaveText('Sem cobrança')

      // ===== 6. Um pedido concluído hoje (todo pelas RPCs) aparece na agenda do dia do N2, em cinza, "Concluída".
      const criado = await rpc(solicitante, 'criar_pedido', { p: pedidoPassageiros(0.5, 4) })
      expect(criado).toMatchObject({ ok: true })
      const idConcluido = criado.id as string
      expect(await rpc(motorista, 'enviar_orcamento', { p_atividade: idConcluido, p: { pedagio_cent: 3210 } })).toMatchObject({ ok: true })
      const o = (await rpc(solicitante, 'pedido', { p_id: idConcluido })).orcamento as { versao: number; hash: string }
      expect(
        await rpc(solicitante, 'aprovar_orcamento', {
          p_atividade: idConcluido,
          p_versao: o.versao,
          p_hash: o.hash,
          p_chave: randomUUID(),
          p_dispositivo: 'e2e',
        }),
      ).toMatchObject({ ok: true })
      await moverInicio(idConcluido, '20 minutes')
      expect(await rpc(motorista, 'registrar_saida', { p_atividade: idConcluido, p_chave: randomUUID() })).toMatchObject({ ok: true })
      expect(await rpc(motorista, 'concluir', { p_atividade: idConcluido, p_observacao: null })).toMatchObject({ ok: true })
      // Perto da meia-noite, "daqui a 20 min" já é amanhã: o início vai para hoje (horário de Brasília).
      await comBanco((db) =>
        db.query(
          `update app.atividades
              set inicio = ((now() at time zone 'America/Sao_Paulo')::date + time '00:01') at time zone 'America/Sao_Paulo',
                  prazo_orcar_ate = least(prazo_orcar_ate,
                                          ((now() at time zone 'America/Sao_Paulo')::date + time '00:01') at time zone 'America/Sao_Paulo')
            where id = $1
              and (inicio at time zone 'America/Sao_Paulo')::date <> (now() at time zone 'America/Sao_Paulo')::date`,
          [idConcluido],
        ),
      )
      const numeroConcluido = ((await rpc(solicitante, 'pedido', { p_id: idConcluido })).pedido as { numero: number; status: string })
      expect(numeroConcluido.status).toBe('CONCLUIDA')

      await pc.goto('/agenda')
      const dia = pc.getByTestId('agenda-dia')
      const concluida = dia.getByTestId('bloco-concluida').filter({ hasText: numeroPedido(numeroConcluido.numero) })
      await expect(concluida).toBeVisible({ timeout: 30_000 })
      await expect(concluida).toContainText('Concluída')
      await expect(concluida).toHaveAttribute('href', `/pedidos/${idConcluido}`)
      // O cancelado não aparece na agenda (nem como ativo nem como concluído).
      await expect(dia.getByText(numeroPedido(numero))).toHaveCount(0)
    } finally {
      await Promise.all([ctxAdm.close(), ctxMot.close(), ctxCli.close()])
    }
  })
})
