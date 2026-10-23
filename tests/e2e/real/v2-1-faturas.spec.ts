import { randomInt } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { simularBlocosDoMapa, simularMapas } from '../apoio/mapasFalsos.ts'
import {
  comBanco,
  criarPessoa,
  empresaComContratoAntigo,
  entrarComDoisFatores,
  entrarComSenha,
  levarParaQuinzenaFechada,
  pdfMinimo,
  rpc,
} from './apoio.ts'

// v2.1 (Tarefa 10) contra o Supabase real do CI (projeto Playwright `real`, um worker), pelas telas do app novo
// (dist-novo, :8789): o faturamento por NF de ponta a ponta.
//   1. O Master publica, em Contratos, a versão "Faturado (NF)" de uma empresa SEM saldo (nenhuma recarga).
//   2. O N2 pede IVO Passageiros com 1 diária e outros custos; o motorista aceita pela tabela (com a HOSPEDAGEM); o N2
//      confirma vendo "Será cobrada na fatura da quinzena (NF)" (sem o saldo e sem bloqueio); a saída gera o DEBITO.
//   3. O Faturado e o DEBITO vão para a última quinzena fechada (SQL de apoio: único atalho de datas).
//   4. O Master gera a fatura da quinzena com o número da NF e o PDF (upload real no bucket notas-fiscais).
//   5. O N1 vê a fatura (Aberta), baixa a NF (o mesmo PDF) e o CSV da fatura.
//   6. O Master marca a fatura como paga; os Lançamentos do N1 mostram o "Pagamento de fatura".
// Só o Google é simulado (como em fase-4-1). O motorista atende os pedidos novos (o ativo mais antigo) só durante o
// teste e é desativado no fim; a empresa e as pessoas são criadas aqui: os outros arquivos, que dividem o banco, não
// veem nada deste. Atalhos no banco: o horário do pedido é puxado para daqui a 20 min (a saída só libera 60 min antes)
// e as datas da quinzena (passo 3); a conclusão vai pela RPC (a tela da viagem é coberta em fase-4-1 e estilo-uber).

const URL_NOVO = 'http://127.0.0.1:8789'
/** Km da rota simulada (`simularMapas`). */
const KM_ROTA = 38.2
const OUTROS_CUSTOS = 'Pedágio da BR-101'
const NUMERO_NF = `E2E-${randomInt(100000, 999999)}`

/** "R$ 164,60" como a tela escreve (o espaço depois do R$ pode ser inseparável), com o milhar. */
const brl = (cent: number) => {
  const reais = Math.floor(cent / 100).toLocaleString('pt-BR')
  return `R\\$\\s${reais.replace('.', '\\.')},${String(cent % 100).padStart(2, '0')}`
}
/** Forma curta ("R$ 360" sem os centavos zerados; "R$ 164,60" com eles). */
const curto = (cent: number) =>
  cent % 100 === 0 ? `R\\$\\s${(cent / 100).toLocaleString('pt-BR').replace('.', '\\.')}(?![\\d,])` : brl(cent)
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

/** O horário do pedido vai para daqui a 20 min (abre a janela de saída); o bloco da agenda anda junto. */
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

/** Lançamentos da empresa, na ordem ("DEBITO:-36000"). */
const lancamentosDaEmpresa = (empresa: string) =>
  comBanco(async (db) =>
    (
      await db.query<{ tipo: string; valor: string }>(
        'select tipo, valor_cent as valor from app.lancamentos where empresa_id = $1 order by id',
        [empresa],
      )
    ).rows.map((l) => `${l.tipo}:${l.valor}`),
  )

interface Linha {
  codigo: string
  quantidade: number | null
  valor_cent: number
}

test.describe('faturamento por NF (v2.1)', () => {
  test.setTimeout(600_000)
  let motoristaDoTeste: string | null = null
  test.afterEach(async () => {
    if (motoristaDoTeste) {
      const id = motoristaDoTeste
      await comBanco((db) => db.query(`update app.perfis set ativo = false where usuario_id = $1`, [id]))
    }
  })

  test('Faturado sem saldo → pedido com diária e outros custos → saída → fatura com NF → N1 baixa NF e CSV → paga', async ({
    browser,
  }) => {
    const motorista = await criarPessoa({ papel: 'MOTORISTA', nome: 'Fábio Fatura' })
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
    // Crédito há 90 dias e nenhuma recarga: saldo zero.
    const empresa = await empresaComContratoAntigo()
    const nomeEmpresa = await comBanco(
      async (db) => (await db.query<{ nome: string }>('select nome from app.empresas where id = $1', [empresa])).rows[0]!.nome,
    )
    const solicitante = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 2, nome: 'Sílvia Fatura' })
    const gestora = await criarPessoa({ papel: 'CLIENTE', empresa, nivel: 1, nome: 'Gilda Fatura' })
    expect(await rpc(solicitante, 'saldo_empresa', { p_empresa: null })).toMatchObject({ saldo_contabil_cent: 0, forma_cobranca: 'CREDITO' })

    const novoContexto = (extra: Parameters<typeof browser.newContext>[0] = {}) =>
      browser.newContext({ ...devices['Pixel 7'], baseURL: URL_NOVO, ...extra })
    const ctxAdm = await novoContexto()
    const ctxMot = await novoContexto({
      geolocation: { latitude: -26.91, longitude: -48.67, accuracy: 10 },
      permissions: ['geolocation'],
    })
    const ctxCli = await novoContexto()
    const ctxGes = await novoContexto({ acceptDownloads: true })
    try {
      // ===== 1. O Master publica a versão "Faturado (NF)" em Contratos (sem RPC de apoio).
      const pa = await ctxAdm.newPage()
      await entrarComDoisFatores(pa, adm.email, adm.senha, adm.segredoTotp!)
      await pa.goto(`/adm/contratos/${empresa}?publicar=1`)
      const folhaContrato = pa.getByRole('dialog', { name: /Publicar nova versão/ })
      await expect(folhaContrato).toBeVisible({ timeout: 30_000 })
      const forma = folhaContrato.getByRole('radiogroup', { name: 'Forma de cobrança' })
      await expect(forma.getByRole('radio', { name: 'Crédito (pré-pago)' })).toHaveAttribute('aria-checked', 'true')
      await forma.getByRole('radio', { name: 'Faturado (NF)' }).click()
      await expect(folhaContrato.getByLabel('Limite de saldo negativo')).toHaveCount(0)
      // Vale a partir do minuto cheio depois do próximo (sempre no futuro na hora do clique); a espera é abaixo.
      const vigencia = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 120_000)
      await folhaContrato.getByLabel('Vale a partir de', { exact: true }).fill(entradaSp(vigencia))
      await folhaContrato.getByRole('button', { name: 'Revisar e publicar' }).click()
      const revisao = folhaContrato.getByTestId('confirmacao-contrato')
      await expect(revisao).toContainText('Faturado (NF)')
      await revisao.getByRole('button', { name: 'Publicar versão' }).click()
      await expect(pa.getByText(/Versão \d+ publicada/).first()).toBeVisible({ timeout: 30_000 })
      expect(
        await comBanco(
          async (db) =>
            (
              await db.query<{ forma_cobranca: string }>(
                'select forma_cobranca from app.contratos_versoes where empresa_id = $1 order by versao desc limit 1',
                [empresa],
              )
            ).rows[0]!.forma_cobranca,
        ),
      ).toBe('FATURADO')
      // A empresa passa ao Faturado quando a versão começa a valer.
      await expect
        .poll(async () => (await rpc(solicitante, 'saldo_empresa', { p_empresa: null })).forma_cobranca, {
          timeout: 180_000,
          intervals: [3_000],
        })
        .toBe('FATURADO')

      // A prévia do banco: Passageiros com 1 diária (HOSPEDAGEM) e trecho único.
      const previa = await rpc(solicitante, 'categorias_disponiveis', { p: { km: KM_ROTA, levar: true, trazer: false, diarias: 1 } })
      expect(previa).toMatchObject({ ok: true })
      const passageiros = (previa.categorias as Array<{ codigo: string; disponivel: boolean; cobra_diaria: boolean; total_cent: number; linhas: Linha[] }>).find(
        (c) => c.codigo === 'PASSAGEIROS',
      )!
      expect(passageiros).toMatchObject({ disponivel: true, cobra_diaria: true })
      expect(passageiros.linhas.map((l) => l.codigo)).toContain('HOSPEDAGEM')
      const TOTAL = passageiros.total_cent
      expect(TOTAL).toBeGreaterThan(0)

      // ===== 2. O N2 pede pela tela nova: 1 diária e outros custos, sem saldo nenhum.
      const pm = await ctxMot.newPage()
      await simularMapas(pm, { rota: { km: KM_ROTA, minutos: 45 } })
      await simularBlocosDoMapa(pm)
      await entrarComDoisFatores(pm, motorista.email, motorista.senha, motorista.segredoTotp!)
      await pm.goto('/')

      const pc = await ctxCli.newPage()
      await simularMapas(pc, { rota: { km: KM_ROTA, minutos: 45 } })
      await simularBlocosDoMapa(pc)
      await entrarComSenha(pc, solicitante.email, solicitante.senha)
      await expect(pc.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Sílvia$/ })).toBeVisible({ timeout: 30_000 })
      // No Faturado o início nunca mostra "sem crédito".
      await expect(pc.getByTestId('pedido-indisponivel')).toHaveCount(0)
      await escolher(pc, 'De', 'Estaleiro Navegantes', /Estaleiro Navegantes/)
      await escolher(pc, 'Para', 'Porto', /Porto de Itajaí/)
      const radioPassageiros = pc.getByRole('radiogroup', { name: 'Categorias' }).getByRole('radio', { name: /IVO Passageiros/ })
      await expect(radioPassageiros).toBeEnabled({ timeout: 30_000 })
      await radioPassageiros.click()
      await pc.getByText('Detalhes da corrida (pessoas, carga, contato)').click()
      const diarias = pc.getByRole('group', { name: 'Diárias (hospedagem)' })
      await expect(diarias).toBeVisible()
      await pc.getByRole('button', { name: 'Aumentar diárias (hospedagem)' }).click()
      await expect(diarias.locator('output')).toHaveText('1')
      await pc.getByRole('textbox', { name: 'Outros custos (opcional)' }).fill(OUTROS_CUSTOS)
      await expect(radioPassageiros).toContainText('+ outros custos no orçamento')
      // A prévia da tela (com a diária) é a do banco.
      await expect(radioPassageiros).toContainText(new RegExp(`~${curto(TOTAL)}`), { timeout: 20_000 })
      const pedir = pc.getByRole('button', { name: /^Pedir IVO Passageiros · / })
      await expect(pedir).toBeEnabled({ timeout: 30_000 })
      await pedir.click()
      await expect(pc).toHaveURL(/\/corrida\/[0-9a-f-]{36}$/, { timeout: 30_000 })
      const id = new URL(pc.url()).pathname.split('/').pop()!
      await expect(pc.getByRole('heading', { name: 'Enviado ao Ivo' })).toBeVisible({ timeout: 20_000 })
      const pedido = await rpc(solicitante, 'pedido', { p_id: id })
      expect(pedido).toMatchObject({
        pedido: {
          status: 'SOLICITADA',
          categoria: 'PASSAGEIROS',
          diarias_estimadas: 1,
          outros_custos: OUTROS_CUSTOS,
          volta_a_origem: false,
          forma_cobranca: 'FATURADO',
        },
      })
      const numero = (pedido.pedido as { numero: number }).numero

      // ===== 3. O motorista aceita pela tabela: o total da prévia, com a HOSPEDAGEM da diária pedida.
      await abrirChamada(pm, id)
      await expect(pm.getByTestId('valor-tabela')).toHaveText(new RegExp(`^${brl(TOTAL)}$`), { timeout: 40_000 })
      await pm.getByRole('button', { name: new RegExp(`^Aceitar por ${curto(TOTAL)}$`) }).click()
      await expect(pm.getByText(/^Proposta enviada\./)).toBeVisible({ timeout: 30_000 })
      const orcado = await rpc(solicitante, 'pedido', { p_id: id })
      expect(orcado).toMatchObject({ pedido: { status: 'ORCADA' }, orcamento: { total_cent: TOTAL } })
      expect((orcado.orcamento as { linhas: Linha[] }).linhas.find((l) => l.codigo === 'HOSPEDAGEM')).toMatchObject({ quantidade: 1 })

      // ===== 4. O N2 confirma sem saldo: "Será cobrada na fatura da quinzena (NF)", nada do saldo.
      const confirmar = pc.getByRole('button', { name: new RegExp(`^Confirmar corrida · ${curto(TOTAL)}$`) })
      await veComRecarga(pc, confirmar)
      const folhaMapa = pc.getByTestId('folha-mapa')
      await expect(folhaMapa).toContainText('Será cobrada na fatura da quinzena (NF)')
      await expect(folhaMapa).not.toContainText('Disponível no saldo')
      await expect(folhaMapa).not.toContainText('faltariam')
      await confirmar.click()
      await expect(pc.getByRole('heading', { name: 'Corrida confirmada' })).toBeVisible({ timeout: 30_000 })
      await expect(folhaMapa).toContainText('Entra na fatura da quinzena quando a corrida começar')
      expect(await rpc(solicitante, 'pedido', { p_id: id })).toMatchObject({ pedido: { status: 'AGENDADA' } })

      // ===== 5. Saída pela tela do motorista (o DEBITO), conclusão pela RPC.
      await puxarParaDaquiA20Min(id)
      await pm.goto(`/viagem/${id}`)
      await pm.getByRole('slider', { name: 'Deslize para sair' }).press('End', { timeout: 30_000 })
      await pm.bringToFront()
      await ctxMot.grantPermissions(['geolocation'], { origin: URL_NOVO })
      await ctxMot.setGeolocation({ latitude: -26.91, longitude: -48.67, accuracy: 10 })
      await pm.getByRole('button', { name: 'Começar a compartilhar' }).click({ timeout: 30_000 })
      await expect(pm.getByTestId('selo-localizacao')).toBeVisible({ timeout: 20_000 })
      expect(await lancamentosDaEmpresa(empresa)).toContain(`DEBITO:-${TOTAL}`)
      expect(await rpc(motorista, 'concluir', { p_atividade: id, p_observacao: null })).toMatchObject({ ok: true })

      // ===== 6. Atalho de datas: o Faturado e o DEBITO na última quinzena fechada.
      const q = await levarParaQuinzenaFechada(empresa, id)
      const rotuloQuinzena = `${q.inicio.slice(8, 10)}/${q.inicio.slice(5, 7)} a ${q.fim.slice(8, 10)}/${q.fim.slice(5, 7)}/${q.fim.slice(0, 4)}`

      // ===== 7. O Master gera a fatura com o número da NF e o PDF.
      const pdf = pdfMinimo()
      await pa.goto(`/adm/faturas/${empresa}`)
      await expect(pa.getByRole('heading', { name: nomeEmpresa, level: 1 })).toBeVisible({ timeout: 30_000 })
      await pa.getByRole('button', { name: 'Gerar fatura' }).click()
      const folhaFatura = pa.getByRole('dialog', { name: 'Gerar fatura' })
      await expect(folhaFatura.getByLabel('Quinzena')).toHaveValue(`${q.inicio}|${q.fim}`)
      await expect(folhaFatura.getByTestId('previa-fatura')).toContainText(`Pedido #${String(numero).padStart(4, '0')}`, { timeout: 30_000 })
      await expect(folhaFatura.getByTestId('total-previa')).toContainText(new RegExp(brl(TOTAL)))
      await folhaFatura.getByLabel('Número da NF').fill(NUMERO_NF)
      await folhaFatura.getByLabel('PDF da NF').setInputFiles({ name: 'nf.pdf', mimeType: 'application/pdf', buffer: pdf })
      await folhaFatura.getByRole('button', { name: 'Confirmar' }).click()
      await expect(pa.getByText('Fatura nº 1 gerada.')).toBeVisible({ timeout: 30_000 })
      const doBanco = await comBanco(
        async (db) =>
          (
            await db.query<{ id: string; total_cent: string; nf_numero: string; status: string; itens: string }>(
              `select f.id, f.total_cent, f.nf_numero, f.status,
                      (select count(*) from app.faturas_itens i where i.fatura_id = f.id and i.ativa) as itens
                 from app.faturas f where f.empresa_id = $1`,
              [empresa],
            )
          ).rows,
      )
      expect(doBanco).toHaveLength(1)
      expect(doBanco[0]).toMatchObject({ total_cent: String(TOTAL), nf_numero: NUMERO_NF, status: 'ABERTA', itens: '1' })

      // ===== 8. O N1 vê a fatura, baixa a NF (o mesmo PDF) e o CSV da fatura.
      const pg = await ctxGes.newPage()
      await entrarComSenha(pg, gestora.email, gestora.senha)
      await expect(pg.getByRole('heading', { name: /^(Bom dia|Boa tarde|Boa noite), Gilda$/ })).toBeVisible({ timeout: 30_000 })
      await pg.goto('/empresa/faturas')
      const fatura = pg.getByRole('list', { name: 'Faturas', exact: true }).getByRole('listitem').filter({ hasText: 'Fatura nº 1' })
      await expect(fatura).toBeVisible({ timeout: 30_000 })
      await expect(fatura).toContainText(rotuloQuinzena)
      await expect(fatura).toContainText(NUMERO_NF)
      await expect(fatura).toContainText(new RegExp(brl(TOTAL)))
      await expect(fatura.getByTestId('etiqueta-fatura')).toHaveText('Aberta')

      const baixandoNf = pg.waitForEvent('download')
      await fatura.getByRole('button', { name: 'Baixar NF (PDF) da fatura nº 1' }).click()
      const nf = await baixandoNf
      expect((await readFile((await nf.path())!)).equals(pdf)).toBe(true)

      const baixandoCsv = pg.waitForEvent('download')
      await fatura.getByRole('button', { name: 'CSV da fatura nº 1' }).click()
      const csv = await baixandoCsv
      expect(csv.suggestedFilename()).toBe('fatura-1.csv')
      const linhas = (await readFile((await csv.path())!, 'utf8')).replace(String.fromCharCode(0xfeff), '').split('\r\n').filter(Boolean)
      expect(linhas[0]).toBe('Data;Quem pediu;De;Paradas;Para;Categoria;Horas;Centro de custo;Valor')
      expect(linhas).toHaveLength(3)
      const corrida = linhas[1]!.split(';')
      expect(corrida.slice(0, 2)).toEqual([`${q.fim.slice(8, 10)}/${q.fim.slice(5, 7)}/${q.fim.slice(0, 4)}`, 'Sílvia Fatura'])
      expect(corrida[5]).toBe('IVO Passageiros')
      expect(corrida.at(-1)).toBe(valorCsv(TOTAL))
      expect(linhas[2]).toBe(`Total;;;;;;;;${valorCsv(TOTAL)}`)

      // ===== 9. O Master marca como paga (data de hoje, a padrão); o livro-razão ganha o PAGAMENTO_FATURA.
      await pa.reload()
      const naLista = pa.getByRole('list', { name: 'Faturas da empresa' }).locator(':scope > li').filter({ hasText: 'Fatura nº 1' })
      await naLista.getByRole('button', { name: 'Marcar como paga' }).click({ timeout: 30_000 })
      const folhaPaga = pa.getByRole('dialog', { name: 'Marcar como paga' })
      await folhaPaga.getByRole('button', { name: 'Confirmar pagamento' }).click()
      await expect(pa.getByText('Fatura nº 1 marcada como paga.')).toBeVisible({ timeout: 30_000 })
      await expect(naLista).toContainText('Paga')
      await expect(naLista.getByRole('button', { name: 'Marcar como paga' })).toHaveCount(0)
      expect((await lancamentosDaEmpresa(empresa)).filter((l) => l.startsWith('PAGAMENTO_FATURA:'))).toEqual([`PAGAMENTO_FATURA:${TOTAL}`])

      // ===== 10. Os Lançamentos do N1 (☰ › Carteira da empresa no Faturado) mostram o pagamento; a fatura, Paga.
      await pg.goto('/extrato')
      await expect(pg.getByRole('heading', { level: 1, name: 'Lançamentos' })).toBeVisible({ timeout: 30_000 })
      const pagamento = pg.getByTestId('lista-extrato').getByTestId('item-extrato').filter({ hasText: 'Pagamento de fatura' })
      await expect(pagamento).toHaveCount(1, { timeout: 30_000 })
      await expect(pagamento).toContainText(new RegExp(brl(TOTAL)))
      await pg.goto('/empresa/faturas')
      await expect(fatura.getByTestId('etiqueta-fatura')).toHaveText('Paga', { timeout: 30_000 })
    } finally {
      await Promise.all([ctxAdm.close(), ctxMot.close(), ctxCli.close(), ctxGes.close()])
    }
  })
})
