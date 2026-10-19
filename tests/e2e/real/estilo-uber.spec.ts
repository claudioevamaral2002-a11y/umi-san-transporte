import { randomInt, randomUUID } from 'node:crypto'
import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { simularBlocosDoMapa, simularMapas } from '../apoio/mapasFalsos.ts'
import { comBanco, criarPessoa, empresaComContrato, entrarComDoisFatores, entrarComSenha, rpc } from './apoio.ts'

// Fase 4 contra o Supabase real do CI (sem mocks de banco): o fluxo inteiro do pedido no estilo Uber, pelas telas do app
// novo (dist-novo, projeto Playwright `real`, servido em :8789).
//   ADM publica o preço por categoria (tela "Categorias e preços") → motorista cadastra o veículo (tela "Meus veículos")
//   → N2 pede Carga Leve → motorista muda os km e a espera na calculadora e envia a proposta → N2 confirma com centro de
//   custo → saída (débito) → posições → conclusão → avaliação.
// Só o Google é simulado (função `enderecos`, locais da empresa e blocos do mapa): o CI não tem chave. Tudo o mais é o
// banco, o Auth e o Realtime do Supabase local.
//
// Um único atalho no banco: o horário do pedido é puxado para daqui a 20 min depois de confirmado. A saída só libera
// 60 min antes do início e o relógio do CI não é nosso (o mesmo que a 3B resolve criando o pedido para daqui a 20 min).

const URL_NOVO = 'http://127.0.0.1:8789'

/** Preços do contrato por categoria publicados pelo ADM (centavos): o km de cada uma e a taxa da Carga Pesada. */
const PRECOS = { PASSAGEIROS: 300, CARGA_LEVE: 400, CARGA_PESADA: 600, TAXA_PESADA: 20000 }

/** Km da rota simulada (`simularMapas`): 38,2 km, trecho único. */
const KM_ROTA = 38.2
/** O que a calculadora do motorista soma: +6 km e 1 h de espera. */
const KM_A_MAIS = 6
const ESPERA_HORAS = 1
/** Do CONTRATO_TESTE: hora de espera e retorno de 50% no trecho único. */
const HORA_ESPERA_CENT = 5000

/** Arredonda meio para cima, como as linhas do orçamento. */
const arred = (x: number) => Math.floor(x + 0.5)
/** Km × preço do km + retorno de 50% (trecho único), cada linha arredondada. */
const kmComRetorno = (km: number, kmCent: number) => {
  const base = arred(km * kmCent)
  return base + arred(base * 0.5)
}
const TOTAL_TABELA = kmComRetorno(KM_ROTA, PRECOS.CARGA_LEVE) // 15280 + 7640 = 22920
const TOTAL_PROPOSTA = kmComRetorno(KM_ROTA + KM_A_MAIS, PRECOS.CARGA_LEVE) + ESPERA_HORAS * HORA_ESPERA_CENT // 26520 + 5000 = 31520
const CENTRO_CUSTO = 'Obra Itajaí 42'

/** "R$ 315,20" como a tela escreve (o espaço entre o R$ e o número pode ser inseparável). */
const reais = (cent: number) => `R\\$\\s${Math.floor(cent / 100)},${String(cent % 100).padStart(2, '0')}`

/** Valor de `<input type="datetime-local">` no horário de São Paulo ("2026-10-20T14:30"). */
function entradaSp(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  )
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

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

test.describe('pedido no estilo Uber (fase 4)', () => {
  test.setTimeout(600_000)
  let motoristaDoTeste: string | null = null
  test.afterEach(async () => {
    if (motoristaDoTeste) {
      const id = motoristaDoTeste
      await comBanco((db) => db.query(`update app.perfis set ativo = false where usuario_id = $1`, [id]))
    }
  })

  test('preço por categoria → veículo → pedido → proposta na calculadora → confirmação → viagem → avaliação', async ({ browser }) => {
    // Este motorista atende os pedidos novos (o ativo mais antigo) só durante o teste; no fim é desativado.
    const motorista = await criarPessoa({ papel: 'MOTORISTA', nome: 'Márcio Viagem' })
    await comBanco((db) =>
      db.query(`update app.perfis set criado_em = now() - interval '40 years' where usuario_id = $1`, [motorista.id]),
    )
    motoristaDoTeste = motorista.id
    const adm = await criarPessoa({ papel: 'ADM' })
    const empresa = await empresaComContrato()
    const cliente = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 2, nome: 'Clara Corrida' })
    // Saldo por RPC (a tela de crédito é da fase 2B e tem teste próprio).
    expect(
      await rpc(adm, 'lancar_recarga', { p_empresa: empresa, p_valor_cent: 100000, p_motivo: 'Pix', p_comprovante: null, p_chave: randomUUID() }),
    ).toMatchObject({ ok: true })

    const novoContexto = (extra: Parameters<typeof browser.newContext>[0] = {}) =>
      browser.newContext({ ...devices['Pixel 7'], baseURL: URL_NOVO, ...extra })
    const ctxAdm = await novoContexto()
    const ctxMot = await novoContexto({
      geolocation: { latitude: -26.91, longitude: -48.67, accuracy: 10 },
      permissions: ['geolocation'],
    })
    const ctxCli = await novoContexto()
    try {
      // ----- 1. ADM publica o preço por categoria (tela "Categorias e preços"), sem RPC de apoio.
      const pa = await ctxAdm.newPage()
      await entrarComDoisFatores(pa, adm.email, adm.senha, adm.segredoTotp!)
      await pa.goto('/adm/categorias')
      await expect(pa.getByRole('heading', { name: 'Categorias e preços', level: 1 })).toBeVisible({ timeout: 30_000 })
      await pa.getByLabel('Contrato', { exact: true }).selectOption(empresa)
      await pa.getByRole('button', { name: 'Publicar nova versão' }).click()
      const folhaPrecos = pa.getByRole('dialog', { name: /Publicar nova versão/ })
      const km = (nome: string) => folhaPrecos.getByLabel(`${nome}: quilômetro`, { exact: true })
      await expect(km('IVO Passageiros')).toBeVisible({ timeout: 30_000 })
      await km('IVO Passageiros').fill('3,00')
      await km('IVO Carga Leve').fill('4,00')
      await km('IVO Carga Pesada').fill('6,00')
      await folhaPrecos.getByLabel('IVO Carga Pesada: taxa fixa', { exact: true }).fill('200,00')
      // A versão vale a partir do próximo minuto cheio (o campo vem com "daqui a 5 min"); a espera é abaixo.
      await folhaPrecos.getByLabel('Vale a partir de', { exact: true }).fill(entradaSp(new Date(Math.floor(Date.now() / 60_000) * 60_000 + 60_000)))
      await folhaPrecos.getByRole('button', { name: 'Revisar e publicar' }).click()
      await expect(folhaPrecos.getByTestId('confirmacao-contrato')).toBeVisible()
      await folhaPrecos.getByRole('button', { name: 'Publicar versão' }).click()
      await expect(pa.getByText(/Versão \d+ publicada\./)).toBeVisible({ timeout: 30_000 })
      // O banco guardou as 3 linhas da versão nova.
      const linhas = await comBanco(async (db) =>
        (
          await db.query<{ categoria: string; km_cent: string; taxa_fixa_cent: string }>(
            `select cc.categoria, cc.km_cent, cc.taxa_fixa_cent
               from app.contratos_categorias cc join app.contratos_versoes v on v.id = cc.contrato_id
              where v.empresa_id = $1 order by cc.categoria`,
            [empresa],
          )
        ).rows.map((l) => `${l.categoria}:${l.km_cent}:${l.taxa_fixa_cent}`),
      )
      expect(linhas).toEqual([
        `CARGA_LEVE:${PRECOS.CARGA_LEVE}:0`,
        `CARGA_PESADA:${PRECOS.CARGA_PESADA}:${PRECOS.TAXA_PESADA}`,
        `PASSAGEIROS:${PRECOS.PASSAGEIROS}:0`,
      ])

      // ----- 2. Motorista cadastra o veículo (tela "Meus veículos").
      const pm = await ctxMot.newPage()
      await simularMapas(pm, { rota: { km: KM_ROTA, minutos: 45 } })
      await simularBlocosDoMapa(pm)
      await entrarComDoisFatores(pm, motorista.email, motorista.senha, motorista.segredoTotp!)
      await pm.goto('/veiculos/novo')
      await expect(pm.getByRole('heading', { name: 'Novo veículo' })).toBeVisible({ timeout: 30_000 })
      const placa = placaNova()
      await pm.getByLabel('Modelo', { exact: true }).fill('Fiorino')
      await pm.getByLabel('Cor', { exact: true }).fill('branca')
      await pm.getByLabel('Placa', { exact: true }).fill(placa)
      await pm.getByLabel('Lugares', { exact: true }).fill('4')
      await pm.getByLabel('Carga máx.', { exact: true }).fill('650')
      await pm.getByRole('checkbox', { name: 'Passageiros', exact: true }).check()
      await pm.getByRole('checkbox', { name: 'Carga Leve', exact: true }).check()
      await pm.getByRole('button', { name: 'Salvar veículo' }).click()
      await expect(pm.getByText(`Fiorino ${placa} salvo.`)).toBeVisible({ timeout: 30_000 })
      await expect(pm.getByRole('list', { name: 'Veículos' })).toContainText(placa)

      // ----- 3. A versão do contrato já vale (começou no minuto cheio seguinte ao da publicação).
      await expect
        .poll(
          async () =>
            comBanco(
              async (db) =>
                (
                  await db.query<{ n: string }>(
                    `select count(*) as n from app.contratos_categorias cc join app.contratos_versoes v on v.id = cc.contrato_id
                      where v.empresa_id = $1 and v.vigente_desde <= now()`,
                    [empresa],
                  )
                ).rows[0]!.n,
            ),
          { timeout: 90_000, intervals: [2_000] },
        )
        .toBe('3')

      // ----- 4. O motorista fica no Início ("Disponível para chamadas") esperando; N2 pede Carga Leve.
      await pm.goto('/')
      await expect(pm.getByText('Nenhuma corrida agendada por enquanto.')).toBeVisible({ timeout: 30_000 })

      const pc = await ctxCli.newPage()
      await simularMapas(pc, { rota: { km: KM_ROTA, minutos: 45 } })
      await simularBlocosDoMapa(pc)
      await entrarComSenha(pc, cliente.email, cliente.senha)
      await expect(pc.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Clara$/ })).toBeVisible({ timeout: 30_000 })
      await expect(pc.getByRole('combobox', { name: 'Origem' })).toHaveValue('Estaleiro Navegantes', { timeout: 20_000 })
      await pc.getByRole('combobox', { name: 'Destino' }).fill('Porto')
      await pc.getByRole('option', { name: /Porto de Itajaí/ }).click()
      const categorias = pc.getByRole('radiogroup', { name: 'Categorias' })
      await expect(categorias.getByRole('radio')).toHaveCount(3, { timeout: 30_000 })
      // O preço estimado vem do contrato (o servidor calcula; a tela só mostra).
      await expect(categorias.getByRole('radio', { name: /IVO Carga Leve/ })).toContainText(new RegExp(`~${reais(TOTAL_TABELA)}`), { timeout: 20_000 })
      await expect(categorias.getByRole('radio', { name: /IVO Passageiros/ })).toContainText(
        new RegExp(`~${reais(kmComRetorno(KM_ROTA, PRECOS.PASSAGEIROS))}`),
      )
      // Ninguém tem veículo com reboque: a Carga Pesada fica indisponível.
      await expect(categorias.getByRole('radio', { name: /IVO Carga Pesada/ })).toContainText('Indisponível no momento')
      await categorias.getByRole('radio', { name: /IVO Carga Leve/ }).click()
      // Carga pede a descrição (nos detalhes da corrida).
      await pc.getByText('Detalhes da corrida (pessoas, carga, contato)').click()
      await pc.getByLabel('Descrição da carga').fill('Duas caixas de ferramentas')
      const pedir = pc.getByRole('button', { name: /^Pedir IVO Carga Leve · / })
      await expect(pedir).toBeEnabled({ timeout: 20_000 })
      await pedir.click()
      await expect(pc).toHaveURL(/\/corrida\/[0-9a-f-]{36}$/, { timeout: 30_000 })
      const id = new URL(pc.url()).pathname.split('/').pop()!
      await expect(pc.getByRole('heading', { name: 'Enviado ao Ivo' })).toBeVisible({ timeout: 20_000 })

      const doBanco = await comBanco(async (db) =>
        (
          await db.query<{ status: string; categoria: string; motorista_id: string }>(
            'select status, categoria, motorista_id from app.atividades where id = $1',
            [id],
          )
        ).rows[0]!,
      )
      expect(doBanco).toMatchObject({ status: 'SOLICITADA', categoria: 'CARGA_LEVE', motorista_id: motorista.id })

      // ----- 5. A chamada chega ao motorista (abre sozinha; se o evento falhar, ele abre pela URL).
      const abriuSozinha = await pm.waitForURL(new RegExp(`/chamada/${id}$`), { timeout: 20_000 }).then(() => true, () => false)
      if (!abriuSozinha) {
        test.info().annotations.push({ type: 'aviso', description: 'chamada não abriu sozinha; aberta pela URL' })
        await pm.goto(`/chamada/${id}`)
      }
      const aceitar = pm.getByRole('button', { name: new RegExp(`^Aceitar por ${reais(TOTAL_TABELA)}$`) })
      await expect(aceitar).toBeVisible({ timeout: 40_000 })
      await expect(pm.getByLabel('Veículo', { exact: true })).toContainText(placa)

      // Contraproposta = calculadora (Ruling R11): +6 km e 1 h de espera; o preço de cada item vem do contrato.
      await pm.getByRole('link', { name: 'Propor outro valor' }).click()
      await expect(pm.getByRole('heading', { name: 'Propor outro valor' })).toBeVisible({ timeout: 30_000 })
      await expect(pm.getByTestId('pela-tabela')).toContainText(new RegExp(`Pela tabela ${reais(TOTAL_TABELA)}`), { timeout: 30_000 })
      for (let i = 0; i < KM_A_MAIS; i++) await pm.getByRole('button', { name: 'Aumentar km rodados' }).click()
      for (let i = 0; i < ESPERA_HORAS * 2; i++) await pm.getByRole('button', { name: 'Aumentar espera (horas)' }).click()
      await expect(pm.getByTestId('total-proposta')).toHaveText(new RegExp(reais(TOTAL_PROPOSTA)), { timeout: 30_000 })
      await expect(pm.getByTestId('diferenca')).toContainText(new RegExp(`\\+\\s${reais(TOTAL_PROPOSTA - TOTAL_TABELA)}`))
      await pm.getByRole('button', { name: new RegExp(`^Enviar proposta · ${reais(TOTAL_PROPOSTA)}$`) }).click()
      await expect(pm.getByText(/^Proposta enviada\./)).toBeVisible({ timeout: 30_000 })

      // ----- 6. N2 vê a contraproposta e confirma com centro de custo.
      const confirmar = pc.getByRole('button', { name: new RegExp(`^Confirmar corrida · ${reais(TOTAL_PROPOSTA)}$`) })
      await veComRecarga(pc, confirmar)
      await expect(pc.getByTestId('comparacao')).toContainText(new RegExp(`Pela tabela ${reais(TOTAL_TABELA)}`))
      await expect(pc.getByTestId('comparacao')).toContainText(new RegExp(`Proposta do Márcio ${reais(TOTAL_PROPOSTA)}`))
      await pc.getByLabel('Centro de custo', { exact: true }).fill(CENTRO_CUSTO)
      await confirmar.click()
      await expect(pc.getByRole('heading', { name: 'Corrida confirmada' })).toBeVisible({ timeout: 30_000 })
      await expect(pc.getByText(CENTRO_CUSTO)).toBeVisible()
      expect(await rpc(cliente, 'pedido', { p_id: id })).toMatchObject({
        pedido: { status: 'AGENDADA', centro_custo: CENTRO_CUSTO, categoria: 'CARGA_LEVE' },
        orcamento: { total_cent: TOTAL_PROPOSTA },
      })

      // ----- 7. Saída: o horário do pedido é puxado para daqui a 20 min (janela de saída; ver o topo do arquivo).
      await comBanco((db) =>
        db.query(
          `update app.atividades set inicio = date_trunc('minute', now()) + interval '20 minutes',
                  prazo_orcar_ate = least(prazo_orcar_ate, date_trunc('minute', now())) where id = $1`,
          [id],
        ),
      )
      await pm.goto(`/viagem/${id}`)
      await pm.getByRole('slider', { name: 'Deslize para sair' }).press('End', { timeout: 30_000 })
      // A tela só muda depois da resposta do banco: a viagem começa pedindo o aceite da localização.
      await pm.bringToFront()
      await ctxMot.grantPermissions(['geolocation'], { origin: URL_NOVO })
      await ctxMot.setGeolocation({ latitude: -26.91, longitude: -48.67, accuracy: 10 })
      await pm.getByRole('button', { name: 'Começar a compartilhar' }).click({ timeout: 30_000 })
      await expect(pm.getByTestId('selo-localizacao')).toBeVisible({ timeout: 20_000 })

      // O DEBITO sai na saída, com o valor da proposta.
      const lancamentos = await comBanco(async (db) =>
        (await db.query<{ tipo: string; valor: string }>('select tipo, valor_cent as valor from app.lancamentos where atividade_id = $1 order by id', [id]))
          .rows.map((l) => `${l.tipo}:${l.valor}`),
      )
      expect(lancamentos).toEqual([`RESERVA:${TOTAL_PROPOSTA}`, `LIBERACAO_RESERVA:${TOTAL_PROPOSTA}`, `DEBITO:-${TOTAL_PROPOSTA}`])

      // ----- 8. Posições: o cliente passa a acompanhar e recebe o sinal (GPS do navegador; sem leitura, 3 posições pela RPC).
      await veComRecarga(pc, pc.getByRole('heading', { name: 'Acompanhando a corrida' }), 30_000)
      const comGps = await expect(pm.getByTestId('selo-localizacao'))
        .toHaveText('Compartilhando sua localização', { timeout: 15_000 })
        .then(() => true, () => false)
      if (!comGps) {
        test.info().annotations.push({ type: 'aviso', description: 'GPS simulado sem leitura no CI; 3 posições enviadas pela RPC' })
        await pc.waitForTimeout(2_000)
        for (let seq = 1; seq <= 3; seq++) {
          expect(
            await rpc(motorista, 'enviar_posicao', { p_atividade: id, p: { lat: -26.91 + seq / 1000, lng: -48.67, precisao: 10, seq } }),
          ).toMatchObject({ ok: true })
          await pc.waitForTimeout(1_500)
        }
      }
      await expect(pc.getByTestId('sinal-motorista')).toHaveText(/Atualizado (agora|há \d+ s)/, { timeout: 30_000 })
      const posicoes = await comBanco(
        async (db) => (await db.query<{ n: string }>('select count(*) as n from app.posicoes where atividade_id = $1', [id])).rows[0]!.n,
      )
      expect(Number(posicoes)).toBeGreaterThanOrEqual(comGps ? 1 : 3)

      // ----- 9. Conclusão: o motorista conclui, o cliente vê o resumo e o trajeto é apagado.
      await pm.getByRole('button', { name: 'Concluir serviço' }).click()
      const folha = pm.getByRole('dialog', { name: 'Concluir serviço' })
      await folha.getByLabel('Observação (opcional)').fill('Caixas entregues na rampa 2')
      await folha.getByRole('button', { name: 'Concluir serviço' }).click()
      await expect(pm.getByRole('heading', { name: 'Serviço concluído' })).toBeVisible({ timeout: 30_000 })
      await expect(pm.getByText('Valor da corrida')).toBeVisible()

      await veComRecarga(pc, pc.getByRole('heading', { name: 'Corrida concluída' }), 30_000)
      const resumo = pc.getByTestId('resumo-corrida')
      await expect(resumo).toContainText(new RegExp(reais(TOTAL_PROPOSTA)))
      await expect(resumo).toContainText(CENTRO_CUSTO)
      const depois = await comBanco(
        async (db) => (await db.query<{ n: string }>('select count(*) as n from app.posicoes where atividade_id = $1', [id])).rows[0]!.n,
      )
      expect(Number(depois)).toBe(0)

      // ----- 10. Avaliação (de 1 a 5, com comentário).
      await pc.getByRole('radio', { name: '5 estrelas' }).click()
      await pc.getByLabel('Comentário (opcional)').fill('Pontual e educado')
      await pc.getByRole('button', { name: 'Enviar avaliação' }).click()
      await expect(pc.getByText('Obrigado pela avaliação.')).toBeVisible({ timeout: 20_000 })
      expect(await rpc(cliente, 'pedido', { p_id: id })).toMatchObject({ pedido: { status: 'CONCLUIDA', avaliacao: 5 } })

      // ----- 11. O extrato tem 1 DEBITO, igual ao total com o ajuste, com o centro de custo.
      const extrato = await rpc(cliente, 'extrato', { p_empresa: null, p_filtro: {} })
      const debitos = (extrato.itens as Array<{ tipo: string; valor_cent: number | string; centro_custo: string | null }>).filter(
        (i) => i.tipo === 'DEBITO',
      )
      expect(debitos).toHaveLength(1)
      expect(Math.abs(Number(debitos[0]!.valor_cent))).toBe(TOTAL_PROPOSTA)
      expect(debitos[0]!.centro_custo).toBe(CENTRO_CUSTO)
    } finally {
      await Promise.all([ctxAdm.close(), ctxMot.close(), ctxCli.close()])
    }
  })
})
