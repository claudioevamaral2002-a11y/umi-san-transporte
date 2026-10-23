import { randomInt, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { simularBlocosDoMapa, simularMapas } from '../apoio/mapasFalsos.ts'
import { comBanco, criarPessoa, empresaComContrato, entrarComDoisFatores, entrarComSenha, rpc } from './apoio.ts'

// Fase 4.1 contra o Supabase real do CI (projeto Playwright `real`, um worker), pelas telas do app novo (dist-novo, :8789):
//   A. O Master publica a tabela por categoria ("Publicar tabela"): IVO Passageiros com km e taxa por parada, IVO
//      Motorista com hora. categorias_disponiveis passa a refletir a tabela. O N2 pede IVO Motorista com 4 horas e centro
//      de custo; o motorista (sem nenhum veículo) aceita pela tabela, igual à prévia do cliente; o N2 confirma; saída
//      (DEBITO) e conclusão. O DEBITO = 4 × hora, com o centro de custo.
//   B. O motorista cadastra um veículo de Passageiros. O N2 pede IVO Passageiros com 2 paradas; a calculadora do motorista
//      dá o mesmo total da prévia e a proposta é gravada; na confirmação o N2 apaga o centro de custo (o pedido fica sem).
//      O DEBITO = km total × km + 2 × taxa por parada.
//   O CSV do painel da empresa traz De, Paradas, Para, Horas e Centro de custo das duas corridas.
// Só o Google é simulado (função `enderecos`, locais da empresa e blocos do mapa): o CI não tem chave. A tabela é
// publicada para a empresa criada aqui (nunca a tabela modelo), e o motorista é desativado no fim: os outros arquivos,
// que dividem o banco, não veem nada deste.
//
// Atalhos no banco, os mesmos de real/estilo-uber.spec.ts: o horário do pedido é puxado para daqui a 20 min depois de
// confirmado (a saída só libera 60 min antes do início; o relógio do CI não é nosso). Na corrida B, saída e conclusão vão
// pelas RPCs (a tela da viagem já é coberta na corrida A e em estilo-uber).

const URL_NOVO = 'http://127.0.0.1:8789'

/** Km da rota simulada (`simularMapas`): toda rota, com ou sem paradas, dá 38,2 km. */
const KM_ROTA = 38.2
/** Tabela publicada (centavos): Passageiros por km e por parada; Motorista por hora. O resto zerado (não cobra). */
const PASSAGEIROS = { km_cent: 300, parada_cent: 2500 }
const MOTORISTA = { hora_cent: 9000 }
const HORAS = 4

/** Arredonda meio para cima, como as linhas do orçamento. */
const arred = (x: number) => Math.floor(x + 0.5)
const TOTAL_A = HORAS * MOTORISTA.hora_cent // 36000
const KM_B_CENT = arred(KM_ROTA * PASSAGEIROS.km_cent) // 11460
const PARADAS_B_CENT = 2 * PASSAGEIROS.parada_cent // 5000
const TOTAL_B = KM_B_CENT + PARADAS_B_CENT // 16460

const CENTRO_A = 'Diretoria 4.1'
const CENTRO_B = 'Obra Paradas 7'

/** "R$ 164,60" como a tela escreve (o espaço depois do R$ pode ser inseparável). */
const brl = (cent: number) => `R\\$\\s${Math.floor(cent / 100)},${String(cent % 100).padStart(2, '0')}`
/** Forma curta ("R$ 360" sem os centavos zerados; "R$ 164,60" com eles). */
const curto = (cent: number) => (cent % 100 === 0 ? `R\\$\\s${cent / 100}(?![\\d,])` : brl(cent))
/** "360,00" como o CSV escreve. */
const valorCsv = (cent: number) => `${Math.floor(cent / 100)},${String(cent % 100).padStart(2, '0')}`

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
 * ÚNICO atalho no banco (o mesmo de estilo-uber): o horário do pedido vai para daqui a 20 min, para abrir a janela de
 * saída. O bloco da agenda anda junto, com a mesma duração; `prazo_orcar_ate` desce junto (constraint atividades_prazo).
 */
async function puxarParaDaquiA20Min(id: string) {
  await comBanco((db) =>
    db.query(
      `with novo as (select date_trunc('minute', now()) + interval '20 minutes' as t),
            a as (update app.atividades x set inicio = (select t from novo),
                         prazo_orcar_ate = least(x.prazo_orcar_ate, (select t from novo))
                   where x.id = $1 returning x.inicio)
       update app.agenda_blocos b set periodo = tstzrange(
                (select t from novo), (select t from novo) + (upper(b.periodo) - lower(b.periodo)), '[)')
        where b.atividade_id = $1 and b.ativo`,
      [id],
    ),
  )
}

/** Lançamentos de um pedido, na ordem ("DEBITO:-36000"). */
const lancamentosDe = (id: string) =>
  comBanco(async (db) =>
    (await db.query<{ tipo: string; valor: string }>('select tipo, valor_cent as valor from app.lancamentos where atividade_id = $1 order by id', [id])).rows.map(
      (l) => `${l.tipo}:${l.valor}`,
    ),
  )

interface Linha {
  codigo: string
  quantidade: number | null
  unitario_cent: number | null
  valor_cent: number
}

test.describe('categorias com tabela, por hora e com paradas (fase 4.1)', () => {
  test.setTimeout(600_000)
  let motoristaDoTeste: string | null = null
  test.afterEach(async () => {
    if (motoristaDoTeste) {
      const id = motoristaDoTeste
      await comBanco((db) => db.query(`update app.perfis set ativo = false where usuario_id = $1`, [id]))
    }
  })

  test('Publicar tabela → IVO Motorista por hora sem veículo → Passageiros com 2 paradas → CSV do painel', async ({ browser }) => {
    // Este motorista atende os pedidos novos (o ativo mais antigo) só durante o teste; no fim é desativado. Começa sem
    // nenhum veículo: a IVO Motorista (veículo do cliente) fica disponível mesmo assim.
    const motorista = await criarPessoa({ papel: 'MOTORISTA', nome: 'Márcio Tabela' })
    await comBanco((db) =>
      db.query(`update app.perfis set criado_em = now() - interval '40 years' where usuario_id = $1`, [motorista.id]),
    )
    motoristaDoTeste = motorista.id
    const adm = await criarPessoa({ papel: 'ADM' })
    const empresa = await empresaComContrato()
    const nomeEmpresa = await comBanco(
      async (db) => (await db.query<{ nome: string }>('select nome from app.empresas where id = $1', [empresa])).rows[0]!.nome,
    )
    const cliente = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 2, nome: 'Clara Paradas' })
    expect(
      await rpc(adm, 'lancar_recarga', { p_empresa: empresa, p_valor_cent: 100000, p_motivo: 'Pix', p_comprovante: null, p_chave: randomUUID() }),
    ).toMatchObject({ ok: true })

    const novoContexto = (extra: Parameters<typeof browser.newContext>[0] = {}) =>
      browser.newContext({ ...devices['Pixel 7'], baseURL: URL_NOVO, ...extra })
    const ctxAdm = await novoContexto({ acceptDownloads: true })
    const ctxMot = await novoContexto({
      geolocation: { latitude: -26.91, longitude: -48.67, accuracy: 10 },
      permissions: ['geolocation'],
    })
    const ctxCli = await novoContexto()
    try {
      // ===== 1. O Master publica a tabela da empresa ("Categorias e preços" → "Publicar tabela"), sem RPC de apoio.
      const pa = await ctxAdm.newPage()
      await entrarComDoisFatores(pa, adm.email, adm.senha, adm.segredoTotp!)
      await pa.goto('/adm/categorias')
      await expect(pa.getByRole('heading', { name: 'Categorias e preços', level: 1 })).toBeVisible({ timeout: 30_000 })
      // A empresa deste teste, nunca a tabela modelo (que os outros arquivos usam).
      await pa.getByLabel('Contrato', { exact: true }).selectOption(empresa)
      await expect(pa.getByLabel('Contrato', { exact: true })).toHaveValue(empresa)
      const cartao = (nome: string) => pa.getByRole('region', { name: nome, exact: true })
      const preencher = async (nome: string, valores: Record<string, string>) => {
        for (const [campo, valor] of Object.entries(valores)) await cartao(nome).getByLabel(campo, { exact: true }).fill(valor)
      }
      await expect(cartao('IVO Passageiros').getByLabel('Por parada', { exact: true })).toBeEditable({ timeout: 30_000 })
      await expect(cartao('IVO Motorista').getByLabel('Por hora', { exact: true })).toBeEditable()
      // Zerado = não cobra: só o km e a parada em Passageiros; só a hora na IVO Motorista. A Carga Leve fica como veio.
      await preencher('IVO Passageiros', {
        'Taxa fixa': '0,00',
        'Por km': '3,00',
        'Por hora': '0,00',
        'Hora de espera': '0,00',
        'Por parada': '25,00',
        Retorno: '0',
        'Diária de hospedagem': '0,00',
      })
      await preencher('IVO Motorista', {
        'Taxa fixa': '0,00',
        'Por km': '0,00',
        'Por hora': '90,00',
        'Hora de espera': '0,00',
        'Por parada': '0,00',
        Retorno: '0',
        'Diária de hospedagem': '0,00',
      })
      await pa.getByRole('button', { name: 'Publicar tabela', exact: true }).click()
      const folha = pa.getByRole('dialog', { name: /Publicar tabela/ })
      await expect(folha).toContainText(nomeEmpresa)
      const revisao = folha.getByTestId('revisao-tabela')
      await expect(revisao).toContainText('IVO Passageiros')
      await expect(revisao).toContainText(/Por parada: .* → R\$\s25,00/)
      await expect(revisao).toContainText(/Por hora: .* → R\$\s90,00/)
      // Vale a partir do minuto cheio depois do próximo (sempre no futuro na hora do clique); a espera é abaixo.
      const vigencia = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 120_000)
      await folha.getByLabel('Vale a partir de', { exact: true }).fill(entradaSp(vigencia))
      await folha.getByRole('button', { name: 'Publicar tabela', exact: true }).click()
      await expect(pa.getByText(/Tabela publicada: versão \d+\./)).toBeVisible({ timeout: 30_000 })

      // O banco guardou a tarifa de cada categoria ativa na versão nova da empresa.
      const tarifas = await comBanco(async (db) =>
        Object.fromEntries(
          (
            await db.query<{ categoria: string; km_cent: string; hora_cent: string; parada_cent: string; taxa_fixa_cent: string; retorno_bp: string }>(
              `select t.categoria, t.km_cent, t.hora_cent, t.parada_cent, t.taxa_fixa_cent, t.retorno_bp
                 from app.tarifas_categoria t join app.contratos_versoes v on v.id = t.contrato_id
                where v.empresa_id = $1
                  and v.versao = (select max(x.versao) from app.contratos_versoes x where x.empresa_id = $1)`,
              [empresa],
            )
          ).rows.map((t) => [t.categoria, `${t.taxa_fixa_cent}/${t.km_cent}/${t.hora_cent}/${t.parada_cent}/${t.retorno_bp}`]),
        ),
      )
      expect(tarifas).toMatchObject({
        PASSAGEIROS: `0/${PASSAGEIROS.km_cent}/0/${PASSAGEIROS.parada_cent}/0`,
        MOTORISTA: `0/0/${MOTORISTA.hora_cent}/0/0`,
      })
      expect(tarifas).toHaveProperty('CARGA_LEVE')

      // categorias_disponiveis reflete a tabela quando a versão começa a valer: IVO Motorista por hora (4 h × R$ 90),
      // disponível sem veículo; Passageiros indisponível (o motorista ainda não tem veículo).
      type Disponivel = { codigo: string; disponivel: boolean; total_cent: number | null; cobra_hora: boolean; cobra_parada: boolean }
      const disponiveis = async (p: Record<string, unknown>) => {
        const r = await rpc(cliente, 'categorias_disponiveis', { p })
        expect(r).toMatchObject({ ok: true })
        return Object.fromEntries((r.categorias as Disponivel[]).map((c) => [c.codigo, c]))
      }
      await expect
        .poll(async () => (await disponiveis({ km: KM_ROTA, levar: true, trazer: false, horas: HORAS })).MOTORISTA, {
          timeout: 180_000,
          intervals: [3_000],
        })
        .toMatchObject({ disponivel: true, total_cent: TOTAL_A, cobra_hora: true, cobra_parada: false })
      const semVeiculo = await disponiveis({ km: KM_ROTA, levar: true, trazer: false, paradas: 2 })
      expect(semVeiculo.PASSAGEIROS).toMatchObject({ disponivel: false, cobra_parada: true, cobra_hora: false })

      // ===== 2. Corrida A: o N2 pede IVO Motorista com 4 horas e centro de custo.
      const pm = await ctxMot.newPage()
      await simularMapas(pm, { rota: { km: KM_ROTA, minutos: 45 } })
      await simularBlocosDoMapa(pm)
      await entrarComDoisFatores(pm, motorista.email, motorista.senha, motorista.segredoTotp!)
      await pm.goto('/')

      const pc = await ctxCli.newPage()
      await simularMapas(pc, { rota: { km: KM_ROTA, minutos: 45 } })
      await simularBlocosDoMapa(pc)
      await entrarComSenha(pc, cliente.email, cliente.senha)
      await expect(pc.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Clara$/ })).toBeVisible({ timeout: 30_000 })
      await escolher(pc, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
      await escolher(pc, 'Para', 'Porto', /Porto de Itajaí/)
      const categorias = pc.getByRole('radiogroup', { name: 'Categorias' })
      const radioMotorista = categorias.getByRole('radio', { name: /IVO Motorista/ })
      await expect(radioMotorista).toBeEnabled({ timeout: 30_000 })
      // Sem as horas, o preço fica pendente ("por hora"); Passageiros sem veículo fica indisponível.
      await expect(radioMotorista).toContainText('por hora')
      await expect(categorias.getByRole('radio', { name: /IVO Passageiros/ })).toContainText('Indisponível no momento')
      await radioMotorista.click()
      const horas = pc.getByRole('group', { name: 'Horas estimadas' })
      await expect(horas).toBeVisible()
      // O primeiro "+" marca 1 h; cada outro soma 0,5 h: 1 + 6 × 0,5 = 4 h.
      for (let i = 0; i < 7; i++) await pc.getByRole('button', { name: 'Aumentar horas estimadas' }).click()
      await expect(horas).toContainText('4 h')
      // A prévia do cliente vem do banco pela tabela publicada.
      await expect(radioMotorista).toContainText(new RegExp(`~${curto(TOTAL_A)}`), { timeout: 20_000 })
      await pc.getByRole('textbox', { name: 'Centro de custo (opcional)' }).fill(CENTRO_A)
      const pedirA = pc.getByRole('button', { name: /^Pedir IVO Motorista · / })
      await expect(pedirA).toBeEnabled({ timeout: 30_000 })
      await pedirA.click()
      await expect(pc).toHaveURL(/\/corrida\/[0-9a-f-]{36}$/, { timeout: 30_000 })
      const idA = new URL(pc.url()).pathname.split('/').pop()!
      await expect(pc.getByRole('heading', { name: 'Enviado ao Ivo' })).toBeVisible({ timeout: 20_000 })
      expect(await rpc(cliente, 'pedido', { p_id: idA })).toMatchObject({
        pedido: { status: 'SOLICITADA', categoria: 'MOTORISTA', horas_estimadas: HORAS, centro_custo: CENTRO_A, paradas: [] },
      })
      const doBancoA = await comBanco(
        async (db) =>
          (
            await db.query<{ modalidade: string; motorista_id: string }>('select modalidade, motorista_id from app.atividades where id = $1', [idA])
          ).rows[0]!,
      )
      expect(doBancoA).toEqual({ modalidade: 'VEICULO_CLIENTE', motorista_id: motorista.id })

      // ===== 3. O motorista, sem veículo, aceita pela tabela: o mesmo total da prévia do cliente.
      await abrirChamada(pm, idA)
      await expect(pm.getByTestId('valor-tabela')).toHaveText(new RegExp(`^${brl(TOTAL_A)}$`), { timeout: 40_000 })
      await expect(pm.getByLabel('Veículo', { exact: true })).toHaveCount(0)
      await pm.getByRole('button', { name: new RegExp(`^Aceitar por ${curto(TOTAL_A)}$`) }).click()
      await expect(pm.getByText(/^Proposta enviada\./)).toBeVisible({ timeout: 30_000 })
      const orcadoA = await rpc(cliente, 'pedido', { p_id: idA })
      expect(orcadoA).toMatchObject({ pedido: { status: 'ORCADA', veiculo: null }, orcamento: { total_cent: TOTAL_A } })
      expect(((orcadoA.orcamento as { linhas: Linha[] }).linhas).map((l) => `${l.codigo}:${l.quantidade}:${l.valor_cent}`)).toEqual([
        `HORAS:${HORAS}:${TOTAL_A}`,
      ])

      // ===== 4. O N2 confirma (o centro de custo do pedido vem no campo) → saída (DEBITO) → conclusão, pelas telas.
      const confirmarA = pc.getByRole('button', { name: new RegExp(`^Confirmar corrida · ${curto(TOTAL_A)}$`) })
      await veComRecarga(pc, confirmarA)
      await expect(pc.getByRole('textbox', { name: 'Centro de custo (opcional)' })).toHaveValue(CENTRO_A)
      await confirmarA.click()
      await expect(pc.getByRole('heading', { name: 'Corrida confirmada' })).toBeVisible({ timeout: 30_000 })
      await expect(pc.getByText(CENTRO_A)).toBeVisible()
      expect(await rpc(cliente, 'pedido', { p_id: idA })).toMatchObject({ pedido: { status: 'AGENDADA', centro_custo: CENTRO_A } })

      await puxarParaDaquiA20Min(idA)
      await pm.goto(`/viagem/${idA}`)
      await pm.getByRole('slider', { name: 'Deslize para sair' }).press('End', { timeout: 30_000 })
      // A tela só muda depois da resposta do banco: a viagem começa pedindo o aceite da localização.
      await pm.bringToFront()
      await ctxMot.grantPermissions(['geolocation'], { origin: URL_NOVO })
      await ctxMot.setGeolocation({ latitude: -26.91, longitude: -48.67, accuracy: 10 })
      await pm.getByRole('button', { name: 'Começar a compartilhar' }).click({ timeout: 30_000 })
      await expect(pm.getByTestId('selo-localizacao')).toBeVisible({ timeout: 20_000 })
      expect(await lancamentosDe(idA)).toContain(`DEBITO:-${TOTAL_A}`)

      await pm.getByRole('button', { name: 'Concluir serviço' }).click()
      const concluir = pm.getByRole('dialog', { name: 'Concluir serviço' })
      await concluir.getByRole('button', { name: 'Concluir serviço' }).click()
      await expect(pm.getByRole('heading', { name: 'Serviço concluído' })).toBeVisible({ timeout: 30_000 })
      expect(await rpc(cliente, 'pedido', { p_id: idA })).toMatchObject({ pedido: { status: 'CONCLUIDA' } })

      // ===== 5. Corrida B: o motorista cadastra um veículo de Passageiros (o cadastro pela tela é de estilo-uber).
      const placa = placaNova()
      expect(
        await rpc(motorista, 'salvar_veiculo', {
          p: { modelo: 'Spin', cor: 'prata', placa, lugares: 6, carga_max_kg: 300, reboque_desc: null, categorias: ['PASSAGEIROS'] },
        }),
      ).toMatchObject({ ok: true })
      expect((await disponiveis({ km: KM_ROTA, levar: true, trazer: false, paradas: 2 })).PASSAGEIROS).toMatchObject({
        disponivel: true,
        total_cent: TOTAL_B,
      })

      // O N2 pede IVO Passageiros com 2 paradas (De → Parada → Parada → Para).
      await pm.goto('/')
      await pc.goto('/')
      await expect(pc.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Clara$/ })).toBeVisible({ timeout: 30_000 })
      const adicionar = pc.getByRole('button', { name: '+ Adicionar parada' })
      await adicionar.click()
      await adicionar.click()
      await expect(pc.getByRole('combobox', { name: /^Parada \d$/ })).toHaveCount(2)
      await escolher(pc, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
      await escolher(pc, 'Parada 1', 'Detroit', /Estaleiro Detroit/)
      await escolher(pc, 'Parada 2', 'Navship', /Estaleiro Navship/)
      await escolher(pc, 'Para', 'Porto', /Porto de Itajaí/)
      const percursoCliente = pc.getByTestId('rota-de-para')
      await expect(percursoCliente).toContainText('Estaleiro Detroit', { timeout: 30_000 })
      await expect(percursoCliente).toContainText('Estaleiro Navship')
      const radioPassageiros = pc.getByRole('radiogroup', { name: 'Categorias' }).getByRole('radio', { name: /IVO Passageiros/ })
      // km × R$ 3 + 2 paradas × R$ 25, do banco.
      await expect(radioPassageiros).toContainText(new RegExp(`~${curto(TOTAL_B)}`), { timeout: 30_000 })
      await radioPassageiros.click()
      // O campo vem com o último centro de custo usado neste aparelho (o da corrida A); este pedido leva outro.
      const centroPedido = pc.getByRole('textbox', { name: 'Centro de custo (opcional)' })
      await expect(centroPedido).toHaveValue(CENTRO_A)
      await centroPedido.fill(CENTRO_B)
      const pedirB = pc.getByRole('button', { name: /^Pedir IVO Passageiros · / })
      await expect(pedirB).toBeEnabled({ timeout: 30_000 })
      await pedirB.click()
      await expect(pc).toHaveURL(/\/corrida\/[0-9a-f-]{36}$/, { timeout: 30_000 })
      const idB = new URL(pc.url()).pathname.split('/').pop()!
      expect(idB).not.toBe(idA)
      await expect(pc.getByRole('heading', { name: 'Enviado ao Ivo' })).toBeVisible({ timeout: 20_000 })
      const pedidoB = await rpc(cliente, 'pedido', { p_id: idB })
      expect(pedidoB).toMatchObject({
        pedido: { status: 'SOLICITADA', categoria: 'PASSAGEIROS', horas_estimadas: null, centro_custo: CENTRO_B },
      })
      // Das paradas do Google, o banco guarda só o place_id (e o texto), nunca o ponto.
      expect((pedidoB.pedido as { paradas: unknown[] }).paradas).toEqual([
        { texto: 'Estaleiro Detroit', place_id: 'ChIJdet', lat: null, lng: null },
        { texto: 'Estaleiro Navship', place_id: 'ChIJnav', lat: null, lng: null },
      ])

      // ===== 6. O motorista abre a calculadora: o total é o da prévia do cliente; a proposta é gravada com esse total.
      await abrirChamada(pm, idB)
      await expect(pm.getByTestId('valor-tabela')).toHaveText(new RegExp(`^${brl(TOTAL_B)}$`), { timeout: 40_000 })
      await expect(pm.getByTestId('rota-de-para').locator('dt')).toHaveText(['De', 'Parada', 'Parada', 'Para'])
      await expect(pm.getByLabel('Veículo', { exact: true })).toContainText(placa)
      await pm.getByRole('link', { name: 'Propor outro valor' }).click()
      await expect(pm.getByRole('heading', { name: 'Propor outro valor' })).toBeVisible({ timeout: 30_000 })
      await expect(pm.getByTestId('pela-tabela')).toHaveText(new RegExp(`Pela tabela ${brl(TOTAL_B)}`), { timeout: 30_000 })
      await expect(pm.getByTestId('itens-proposta')).toContainText('Paradas: 2')
      await expect(pm.getByTestId('total-proposta')).toHaveText(new RegExp(brl(TOTAL_B)), { timeout: 30_000 })
      await pm.getByRole('button', { name: new RegExp(`^Enviar proposta · ${curto(TOTAL_B)}$`) }).click()
      await expect(pm.getByText(/^Proposta enviada\./)).toBeVisible({ timeout: 30_000 })
      const orcadoB = await rpc(cliente, 'pedido', { p_id: idB })
      expect(orcadoB).toMatchObject({ pedido: { status: 'ORCADA' }, orcamento: { total_cent: TOTAL_B } })
      expect(((orcadoB.orcamento as { linhas: Linha[] }).linhas).map((l) => `${l.codigo}:${l.quantidade}:${l.valor_cent}`)).toEqual([
        `KM:${KM_ROTA}:${KM_B_CENT}`,
        `PARADAS:2:${PARADAS_B_CENT}`,
      ])

      // ===== 7. O N2 confirma apagando o centro de custo: o pedido fica sem.
      const confirmarB = pc.getByRole('button', { name: new RegExp(`^Confirmar corrida · ${curto(TOTAL_B)}$`) })
      await veComRecarga(pc, confirmarB)
      const centroConfirmar = pc.getByRole('textbox', { name: 'Centro de custo (opcional)' })
      await expect(centroConfirmar).toHaveValue(CENTRO_B)
      await centroConfirmar.fill('')
      await confirmarB.click()
      await expect(pc.getByRole('heading', { name: 'Corrida confirmada' })).toBeVisible({ timeout: 30_000 })
      expect(await rpc(cliente, 'pedido', { p_id: idB })).toMatchObject({ pedido: { status: 'AGENDADA', centro_custo: null } })

      // Saída e conclusão pelas RPCs (a tela da viagem foi coberta na corrida A).
      await puxarParaDaquiA20Min(idB)
      expect(await rpc(motorista, 'registrar_saida', { p_atividade: idB, p_chave: randomUUID() })).toMatchObject({ ok: true })
      expect(await rpc(motorista, 'concluir', { p_atividade: idB, p_observacao: null })).toMatchObject({ ok: true })

      // ===== 8. O extrato: 1 DEBITO por corrida, igual ao orçamento; centro de custo na A, nenhum na B.
      expect((await lancamentosDe(idA)).filter((l) => l.startsWith('DEBITO:'))).toEqual([`DEBITO:-${TOTAL_A}`])
      expect((await lancamentosDe(idB)).filter((l) => l.startsWith('DEBITO:'))).toEqual([`DEBITO:-${TOTAL_B}`])
      const extrato = await rpc(cliente, 'extrato', { p_empresa: null, p_filtro: {} })
      const debitos = (
        extrato.itens as Array<{ tipo: string; valor_cent: number | string; centro_custo: string | null; atividade_id: string | null }>
      ).filter((i) => i.tipo === 'DEBITO')
      expect(debitos).toHaveLength(2)
      const debitoA = debitos.find((d) => d.atividade_id === idA)!
      const debitoB = debitos.find((d) => d.atividade_id === idB)!
      expect(Math.abs(Number(debitoA.valor_cent))).toBe(TOTAL_A)
      expect(debitoA.centro_custo).toBe(CENTRO_A)
      expect(Math.abs(Number(debitoB.valor_cent))).toBe(TOTAL_B)
      expect(debitoB.centro_custo).toBeNull()

      // ===== 9. O CSV do painel da empresa (Master, aba Corridas): De, Paradas, Para, Horas e Centro de custo.
      const textos = await comBanco(async (db) =>
        Object.fromEntries(
          (
            await db.query<{ id: string; origem: string; destino: string }>(
              'select id, origem, destino from app.atividades where id = any($1::uuid[])',
              [[idA, idB]],
            )
          ).rows.map((r) => [r.id, r]),
        ),
      )
      await pa.goto(`/empresa/corridas?empresa=${empresa}`)
      const exportar = pa.getByRole('button', { name: 'Exportar CSV' })
      await expect(exportar).toBeEnabled({ timeout: 30_000 })
      const baixando = pa.waitForEvent('download')
      await exportar.click()
      const arquivo = await baixando
      const csv = (await readFile((await arquivo.path())!, 'utf8')).replace(String.fromCharCode(0xfeff), '')
      const linhas = csv.split('\r\n').filter(Boolean)
      expect(linhas[0]).toBe('Data;Quem pediu;De;Paradas;Para;Categoria;Horas;Centro de custo;Valor')
      expect(linhas).toHaveLength(3)
      const porCategoria = Object.fromEntries(linhas.slice(1).map((l) => l.split(';')).map((c) => [c[5], c]))
      // [Data, Quem pediu, De, Paradas, Para, Categoria, Horas, Centro de custo, Valor]
      expect(porCategoria['IVO Motorista']!.slice(1)).toEqual([
        'Clara Paradas',
        textos[idA]!.origem,
        '',
        textos[idA]!.destino,
        'IVO Motorista',
        String(HORAS),
        CENTRO_A,
        valorCsv(TOTAL_A),
      ])
      expect(porCategoria['IVO Passageiros']!.slice(1)).toEqual([
        'Clara Paradas',
        textos[idB]!.origem,
        'Estaleiro Detroit | Estaleiro Navship',
        textos[idB]!.destino,
        'IVO Passageiros',
        '',
        '',
        valorCsv(TOTAL_B),
      ])
      expect(textos[idA]!.origem).toContain('Estaleiro Navegantes')
      expect(textos[idB]!.destino).toContain('Porto de Itajaí')
    } finally {
      await Promise.all([ctxAdm.close(), ctxMot.close(), ctxCli.close()])
    }
  })
})
