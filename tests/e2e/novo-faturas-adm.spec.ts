// v2.1 (Tarefa 9): o Master no Faturado (NF). Forma de cobrança no contrato, ☰ › Faturas (lista e empresa), a folha
// "Gerar fatura" (sobe o PDF e só depois chama gerar_fatura), "Marcar como paga", "Cancelar fatura", "Trocar PDF",
// "Baixar NF (PDF)", as pendências no Início e a etiqueta "Faturado (NF)" em Créditos. Projeto Playwright `novo`.
// O storage é simulado pela rota do endpoint (upload e link assinado). Nada muda na tela antes da resposta do servidor.
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { EMPRESA_PORTO, EMPRESA_UMI, linhaContrato, simularApi, versaoFalsa } from './apoio/apiFalsa.ts'
import { painelFalso, saldoFalso, simularDinheiro } from './apoio/dinheiroFalso.ts'
import { simularMapas } from './apoio/mapasFalsos.ts'
import { simularPedidos } from './apoio/pedidosFalsos.ts'
import { comSessaoFalsa, json, URL_SUPABASE, type PerfilFalso } from './apoio/sessaoFalsa.ts'

const ADM: PerfilFalso = { papel: 'ADM', nome: 'Ana Souza', tem_2fa: true }
const N1: PerfilFalso = { papel: 'CLIENTE', nivel: 1, nome: 'Marina Souza', empresa_nome: 'Umi San' }
const AAL2 = { aal: 'aal2' as const }
const UMI = EMPRESA_UMI.id
const F1 = '00000000-0000-4000-8000-0000000000f1'
const F2 = '00000000-0000-4000-8000-0000000000f2'
const F3 = '00000000-0000-4000-8000-0000000000f3'

// ------------------------------------------------------------------------------------------------
// Datas (America/Sao_Paulo), como a tela calcula
// ------------------------------------------------------------------------------------------------

const DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
const hoje = () => DIA.format(new Date())
function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** A última quinzena fechada: 1–15 do mês, se hoje é dia 16 ou depois; senão, 16–último do mês anterior. */
function ultimaQuinzenaFechada(): { inicio: string; fim: string } {
  const h = hoje()
  if (Number(h.slice(8, 10)) >= 16) return { inicio: `${h.slice(0, 7)}-01`, fim: `${h.slice(0, 7)}-15` }
  const fim = somarDias(`${h.slice(0, 7)}-01`, -1)
  return { inicio: `${fim.slice(0, 7)}-16`, fim }
}
const rotulo = (q: { inicio: string; fim: string }) =>
  `${q.inicio.slice(8, 10)}/${q.inicio.slice(5, 7)} a ${q.fim.slice(8, 10)}/${q.fim.slice(5, 7)}/${q.fim.slice(0, 4)}`

// ------------------------------------------------------------------------------------------------
// Respostas simuladas
// ------------------------------------------------------------------------------------------------

const item = (id: number, numero: number, valor: number, extra: Record<string, unknown> = {}) => ({
  lancamento_id: id,
  criado_em: '2026-10-20T15:00:00Z',
  tipo: 'DEBITO',
  valor_cent: valor,
  numero,
  solicitante_nome: 'Diego Rocha',
  origem: 'Glória, Vila Velha',
  paradas: [],
  destino: 'Porto de Vitória',
  categoria_nome: 'IVO Carga Leve',
  centro_custo: 'Obra 12',
  ...extra,
})

const fatura = (id: string, numero: number, status: string, situacao: string, extra: Record<string, unknown> = {}) => ({
  id,
  numero,
  inicio: '2026-09-01',
  fim: '2026-09-15',
  total_cent: 250000,
  nf_numero: `NF-${numero}`,
  nf_emitida_em: '2026-09-16',
  nf_pdf_caminho: `${UMI}/nota-${numero}.pdf`,
  vencimento: '2026-10-16',
  status,
  situacao,
  paga_em: status === 'PAGA' ? '2026-10-10' : null,
  ...extra,
})

const RESUMO = [
  {
    empresa_id: UMI,
    empresa_nome: 'Umi San',
    a_faturar_cent: 180000,
    em_aberto_cent: 250000,
    vencidas_cent: 250000,
    quinzena_pronta: { inicio: '2026-10-01', fim: '2026-10-15' },
  },
]

const FATURAS = {
  ok: true,
  forma_cobranca: 'FATURADO',
  // O segundo item foi às 22h30 de 20/10 em Brasília (01h30 de 21/10 em UTC): aparece como 20/10.
  a_faturar: { total_cent: 180000, itens: [item(21, 42, -180000), item(23, 44, 0, { criado_em: '2026-10-21T01:30:00+00:00' })] },
  em_aberto_cent: 250000,
  vencidas_cent: 250000,
  faturas: [
    fatura(F3, 3, 'CANCELADA', 'CANCELADA', { inicio: '2026-09-16', fim: '2026-09-30' }),
    fatura(F2, 2, 'ABERTA', 'VENCIDA', { inicio: '2026-09-16', fim: '2026-09-30' }),
    fatura(F1, 1, 'PAGA', 'PAGA'),
  ],
}

type Chamada = { rpc: string; corpo: Record<string, unknown> }

/** As RPCs e o storage das faturas. As escritas respondem na ordem de `respostas` (padrão `{ok: true}`). */
async function simularFaturas(page: Page, respostas: Record<string, unknown[]> = {}, resumo: unknown[] = RESUMO) {
  const chamadas: Chamada[] = []
  const rota = (nome: string, responder: (c: Record<string, unknown>) => unknown) =>
    page.route(`${URL_SUPABASE}/rest/v1/rpc/${nome}`, (route) => {
      const corpo = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
      chamadas.push({ rpc: nome, corpo })
      return json(route, responder(corpo))
    })
  await rota('faturas_resumo', () => ({ ok: true, empresas: resumo }))
  await rota('faturas', () => FATURAS)
  await rota('previa_fatura', () => ({ ok: true, total_cent: 180000, itens: [item(21, 42, -180000), item(22, 43, -2500, { tipo: 'MULTA' })] }))
  const padrao: Record<string, unknown> = {
    gerar_fatura: { ok: true, fatura: F2, numero: 4 },
    marcar_fatura_paga: { ok: true },
    cancelar_fatura: { ok: true },
    trocar_pdf_fatura: { ok: true },
  }
  const filas = Object.fromEntries(Object.entries(respostas).map(([k, v]) => [k, [...v]]))
  for (const nome of Object.keys(padrao)) await rota(nome, () => filas[nome]?.shift() ?? padrao[nome])
  // Storage: o upload do PDF e o link assinado (60 s) da NF.
  await page.route(`${URL_SUPABASE}/storage/v1/object/notas-fiscais/**`, (route) => {
    chamadas.push({ rpc: 'storage', corpo: { url: route.request().url(), metodo: route.request().method() } })
    return json(route, { Key: 'notas-fiscais/x.pdf', Id: 'x' })
  })
  await page.route(`${URL_SUPABASE}/storage/v1/object/sign/notas-fiscais/**`, (route) => {
    const url = route.request().url()
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4' })
    chamadas.push({ rpc: 'link', corpo: { url } })
    return json(route, { signedURL: `/object/sign/notas-fiscais/${UMI}/nota-2.pdf?token=t` })
  })
  return chamadas
}

/** Painel do ADM com a Umi San no Faturado (o `interno.saldos` devolve a forma). */
const PAINEL_FATURADO = (() => {
  const p = painelFalso()
  return { ...p, empresas: p.empresas.map((e) => (e.empresa_id === UMI ? { ...e, forma_cobranca: 'FATURADO' } : { ...e, forma_cobranca: 'CREDITO' })) }
})()

async function abrir(
  page: Page,
  caminho: string,
  opcoes: { perfil?: PerfilFalso; respostas?: Record<string, unknown[]>; saldos?: unknown[]; resumo?: unknown[] } = {},
) {
  const perfil = opcoes.perfil ?? ADM
  await comSessaoFalsa(page, perfil, perfil.papel === 'CLIENTE' ? {} : AAL2)
  await simularMapas(page)
  await page.route('https://tile.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  const api = await simularApi(page, {
    vigente: [versaoFalsa(3)],
    contratos: [linhaContrato(EMPRESA_UMI, versaoFalsa(2, { forma_cobranca: 'CREDITO' })), linhaContrato(EMPRESA_PORTO, null)],
    historicoEmpresas: { [UMI]: [versaoFalsa(2, { forma_cobranca: 'CREDITO' })] },
    empresas: [EMPRESA_UMI, EMPRESA_PORTO],
  })
  await simularPedidos(page)
  const dinheiro = await simularDinheiro(page, { painel: PAINEL_FATURADO, saldos: opcoes.saldos })
  // O formulário de contrato do app novo lê os nomes e os preços por categoria e publica por categoria.
  const contrato: Chamada[] = []
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/categorias_adm`, (r) =>
    json(r, {
      ok: true,
      categorias: [
        { codigo: 'PASSAGEIROS', nome: 'IVO Passageiros', descricao_curta: '', ordem: 1, ativa: true },
        { codigo: 'CARGA_LEVE', nome: 'IVO Carga Leve', descricao_curta: '', ordem: 2, ativa: true },
        { codigo: 'CARGA_PESADA', nome: 'IVO Carga Pesada', descricao_curta: '', ordem: 3, ativa: true },
      ],
      precos: {
        PASSAGEIROS: { km_cent: 300, taxa_fixa_cent: 0 },
        CARGA_LEVE: { km_cent: 400, taxa_fixa_cent: 0 },
        CARGA_PESADA: { km_cent: 600, taxa_fixa_cent: 15000 },
      },
    }),
  )
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/publicar_contrato_categorias`, (r) => {
    contrato.push({ rpc: 'publicar_contrato_categorias', corpo: r.request().postDataJSON() as Record<string, unknown> })
    return json(r, { ok: true, versao: 3 })
  })
  const faturas = await simularFaturas(page, opcoes.respostas, opcoes.resumo)
  await page.goto(caminho)
  return { api, dinheiro, contrato, faturas }
}

const PDF = { name: 'nf-1234.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 nota') }

// ------------------------------------------------------------------------------------------------
// Contrato: forma de cobrança
// ------------------------------------------------------------------------------------------------

test('contrato: "Forma de cobrança"; no Faturado o limite e o alerta somem, há aviso do saldo e publicar manda a forma', async ({ page }) => {
  const { contrato, dinheiro } = await abrir(page, `/adm/contratos/${UMI}?publicar=1`)
  const folha = page.getByRole('dialog', { name: /Publicar nova versão/ })
  const forma = folha.getByRole('radiogroup', { name: 'Forma de cobrança' })
  await expect(forma.getByRole('radio', { name: 'Crédito (pré-pago)' })).toHaveAttribute('aria-checked', 'true')
  await expect(folha.getByLabel('Limite de saldo negativo')).toBeVisible()
  await expect(folha.getByLabel('Alerta de saldo baixo')).toBeVisible()

  await forma.getByRole('radio', { name: 'Faturado (NF)' }).click()
  await expect(forma.getByRole('radio', { name: 'Faturado (NF)' })).toHaveAttribute('aria-checked', 'true')
  await expect(folha.getByLabel('Limite de saldo negativo')).toHaveCount(0)
  await expect(folha.getByLabel('Alerta de saldo baixo')).toHaveCount(0)
  // O saldo contábil da Umi San não está zerado (R$ 3.200,00): avisa, sem bloquear.
  const aviso = folha.getByTestId('aviso-saldo-faturado')
  await expect(aviso).toContainText('R$ 3.200,00')
  await expect(aviso).toContainText('Ajuste')
  expect(dinheiro.some((c) => c.rpc === 'saldo_empresa' && c.corpo.p_empresa === UMI)).toBe(true)

  await folha.getByRole('button', { name: 'Revisar e publicar' }).click()
  const revisao = folha.getByTestId('confirmacao-contrato')
  await expect(revisao).toContainText('Forma de cobrança')
  await expect(revisao).toContainText('Faturado (NF)')
  await folha.getByRole('button', { name: 'Publicar versão' }).click()
  await expect(page.getByText(/Versão 3 publicada/)).toBeVisible()
  const p = contrato[0]!.corpo.p as Record<string, unknown>
  expect(p.forma_cobranca).toBe('FATURADO')
  // No Faturado, o limite e o alerta (escondidos) vão como 0.
  expect(p.limite_saldo_negativo_cent).toBe(0)
  expect(p.alerta_saldo_baixo_cent).toBe(0)
})

test('contrato: com o saldo zerado não há aviso; voltar ao Crédito mostra o limite e o alerta de novo', async ({ page }) => {
  const { dinheiro } = await abrir(page, `/adm/contratos/${UMI}?publicar=1`, {
    saldos: [saldoFalso({ saldo_contabil_cent: 0, disponivel_cent: 0, reservado_cent: 0 })],
  })
  const folha = page.getByRole('dialog', { name: /Publicar nova versão/ })
  const forma = folha.getByRole('radiogroup', { name: 'Forma de cobrança' })
  await forma.getByRole('radio', { name: 'Faturado (NF)' }).click()
  await expect(folha.getByLabel('Limite de saldo negativo')).toHaveCount(0)
  await expect.poll(() => dinheiro.some((c) => c.rpc === 'saldo_empresa' && c.corpo.p_empresa === UMI)).toBe(true)
  await expect(folha.getByTestId('aviso-saldo-faturado')).toHaveCount(0)
  await forma.getByRole('radio', { name: 'Crédito (pré-pago)' }).click()
  await expect(folha.getByLabel('Limite de saldo negativo')).toBeVisible()
})

test('contrato: o cartão vigente mostra a forma de cobrança', async ({ page }) => {
  await abrir(page, `/adm/contratos/${UMI}`)
  await expect(page.getByTestId('cartao-credito')).toContainText('Crédito (pré-pago)')
})

// ------------------------------------------------------------------------------------------------
// ☰ › Faturas
// ------------------------------------------------------------------------------------------------

test('☰ › Faturas lista as empresas do faturas_resumo com A faturar, Em aberto e Vencidas', async ({ page }) => {
  const { faturas } = await abrir(page, '/')
  await page.getByRole('button', { name: 'Abrir menu' }).click()
  const menu = page.getByRole('dialog', { name: 'Menu' })
  await expect(menu.getByRole('link', { name: 'Faturas', exact: true })).toHaveAttribute('href', '/adm/faturas')
  await menu.getByRole('link', { name: 'Faturas', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Faturas', level: 1 })).toBeVisible()
  const linha = page.getByTestId('lista-faturas-empresas').getByRole('link', { name: /Umi San/ })
  await expect(linha).toHaveAttribute('href', `/adm/faturas/${UMI}`)
  await expect(linha).toContainText('A faturar')
  await expect(linha).toContainText('R$ 1.800,00')
  await expect(linha).toContainText('Em aberto')
  await expect(linha).toContainText('Vencidas')
  await expect(linha).toContainText('R$ 2.500,00')
  expect(faturas.some((c) => c.rpc === 'faturas_resumo')).toBe(true)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

test('Início do Master: "Quinzena fechada: Umi San pronta para faturar" e "Faturas vencidas"', async ({ page }) => {
  await abrir(page, '/')
  const pend = page.getByTestId('pendencias-faturas')
  await expect(pend.getByRole('link', { name: 'Quinzena fechada: Umi San pronta para faturar' })).toHaveAttribute('href', `/adm/faturas/${UMI}`)
  await expect(pend).toContainText('Faturas vencidas')
  await expect(pend).toContainText('R$ 2.500,00')
})

test('Painel do Master também mostra as pendências das faturas; sem empresa pronta, nada aparece', async ({ browser }) => {
  for (const [resumo, visivel] of [
    [RESUMO, true],
    [[{ ...RESUMO[0], quinzena_pronta: null, vencidas_cent: 0 }], false],
  ] as const) {
    const contexto = await browser.newContext()
    const page = await contexto.newPage()
    await abrir(page, '/adm/painel', { resumo: [...resumo] })
    await expect(page.getByTestId('painel-credito')).toBeVisible()
    if (visivel) await expect(page.getByText('Quinzena fechada: Umi San pronta para faturar')).toBeVisible()
    else await expect(page.getByTestId('pendencias-faturas')).toHaveCount(0)
    await contexto.close()
  }
})

test('empresa: os totais, as faturas com as etiquetas e as ações certas de cada uma', async ({ page }) => {
  await abrir(page, `/adm/faturas/${UMI}`)
  await expect(page.getByRole('heading', { name: 'Umi San', level: 1 })).toBeVisible()
  await expect(page.getByTestId('total-a-faturar')).toContainText('R$ 1.800,00')
  await expect(page.getByTestId('total-vencidas')).toContainText('R$ 2.500,00')
  const lista = page.getByRole('list', { name: 'Faturas da empresa' })
  const f2 = lista.locator(':scope > li').filter({ hasText: 'Fatura nº 2' })
  const f1 = lista.locator(':scope > li').filter({ hasText: 'Fatura nº 1' })
  const f3 = lista.locator(':scope > li').filter({ hasText: 'Fatura nº 3' })
  await expect(f2).toContainText('Vencida')
  await expect(f2).toContainText('16/09 a 30/09/2026')
  await expect(f2).toContainText('NF-2')
  await expect(f1).toContainText('Paga')
  await expect(f3).toContainText('Cancelada')
  for (const nome of ['Marcar como paga', 'Cancelar fatura', 'Trocar PDF', 'Baixar NF (PDF)']) {
    await expect(f2.getByRole('button', { name: nome })).toBeVisible()
  }
  // Paga: sem trocar o PDF, sem cancelar e sem marcar de novo; só baixar.
  await expect(f1.getByRole('button', { name: 'Trocar PDF' })).toHaveCount(0)
  await expect(f1.getByRole('button', { name: 'Marcar como paga' })).toHaveCount(0)
  await expect(f1.getByRole('button', { name: 'Cancelar fatura' })).toHaveCount(0)
  await expect(f1.getByRole('button', { name: 'Baixar NF (PDF)' })).toBeVisible()
  await expect(f3.getByRole('button', { name: 'Marcar como paga' })).toHaveCount(0)
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})

test('as datas dos itens são as de Brasília: 01h30 UTC de 21/10 aparece como 20/10', async ({ page }) => {
  await abrir(page, `/adm/faturas/${UMI}`)
  const item44 = page.getByRole('region', { name: 'A faturar' }).getByRole('listitem').filter({ hasText: 'Pedido #0044' })
  await expect(item44).toContainText('20/10/2026')
  await expect(item44).not.toContainText('21/10/2026')
})

test('empresa de volta ao Crédito com algo a faturar ainda mostra "Gerar fatura"', async ({ page }) => {
  await abrir(page, `/adm/faturas/${UMI}`)
  // A rota registrada por último vence: a mesma empresa, agora no Crédito.
  await page.route(`${URL_SUPABASE}/rest/v1/rpc/faturas`, (r) => json(r, { ...FATURAS, forma_cobranca: 'CREDITO' }))
  await page.reload()
  await expect(page.getByText('Esta empresa voltou ao Crédito (pré-pago), mas ainda tem valores a faturar.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Gerar fatura' })).toBeVisible()
})

test('"Gerar fatura": a última quinzena fechada, a prévia, o vencimento +30; confirmar sobe o PDF e depois gera', async ({ page }) => {
  const { faturas } = await abrir(page, `/adm/faturas/${UMI}`)
  await page.getByRole('button', { name: 'Gerar fatura' }).click()
  const folha = page.getByRole('dialog', { name: 'Gerar fatura' })
  const q = ultimaQuinzenaFechada()
  await expect(folha.getByLabel('Quinzena')).toHaveValue(`${q.inicio}|${q.fim}`)
  await expect(folha.getByLabel('Quinzena').locator('option:checked')).toHaveText(rotulo(q))
  await expect.poll(() => faturas.find((c) => c.rpc === 'previa_fatura')?.corpo).toEqual({ p_empresa: UMI, p_inicio: q.inicio, p_fim: q.fim })
  const previa = folha.getByTestId('previa-fatura')
  await expect(previa).toContainText('Pedido #0042')
  await expect(previa).toContainText('Diego Rocha')
  await expect(folha.getByTestId('total-previa')).toContainText('R$ 1.800,00')
  expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual([])

  await expect(folha.getByLabel('Emissão da NF')).toHaveValue(hoje())
  await expect(folha.getByLabel('Vencimento')).toHaveValue(somarDias(hoje(), 30))
  await folha.getByLabel('Emissão da NF').fill('2026-11-03')
  await expect(folha.getByLabel('Vencimento')).toHaveValue('2026-12-03')

  // Sem número e sem PDF: não envia nada.
  await folha.getByRole('button', { name: 'Confirmar' }).click()
  await expect(folha.getByText('Informe o número da NF (até 30 caracteres).')).toBeVisible()
  await expect(folha.getByText('Anexe o PDF da NF.')).toBeVisible()
  expect(faturas.filter((c) => c.rpc === 'storage' || c.rpc === 'gerar_fatura')).toHaveLength(0)

  await folha.getByLabel('Número da NF').fill(' 1234 ')
  await folha.getByLabel('PDF da NF').setInputFiles(PDF)
  await folha.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.getByText('Fatura nº 4 gerada.')).toBeVisible()
  await expect(folha).toBeHidden()
  const iUpload = faturas.findIndex((c) => c.rpc === 'storage')
  const iGerar = faturas.findIndex((c) => c.rpc === 'gerar_fatura')
  expect(iUpload).toBeGreaterThanOrEqual(0)
  expect(iGerar).toBeGreaterThan(iUpload)
  expect(String(faturas[iUpload]!.corpo.url)).toContain(`/notas-fiscais/${UMI}/`)
  const g = faturas[iGerar]!.corpo
  expect(g.p_empresa).toBe(UMI)
  expect(g.p_inicio).toBe(q.inicio)
  expect(g.p_fim).toBe(q.fim)
  const nf = g.p_nf as Record<string, unknown>
  expect(nf).toMatchObject({ numero: '1234', emitida_em: '2026-11-03', vencimento: '2026-12-03' })
  expect(String(nf.pdf_caminho)).toMatch(new RegExp(`^${UMI}/[0-9a-f-]{36}\\.pdf$`))
})

test('"Gerar fatura" com recusa depois do upload: mostra o erro, mantém o formulário e não sobe o PDF de novo', async ({ page }) => {
  const { faturas } = await abrir(page, `/adm/faturas/${UMI}`, { respostas: { gerar_fatura: [{ ok: false, codigo: 'NADA_A_FATURAR' }] } })
  await page.getByRole('button', { name: 'Gerar fatura' }).click()
  const folha = page.getByRole('dialog', { name: 'Gerar fatura' })
  await expect(folha.getByTestId('total-previa')).toContainText('R$ 1.800,00')
  await folha.getByLabel('Número da NF').fill('1234')
  await folha.getByLabel('PDF da NF').setInputFiles(PDF)
  await folha.getByRole('button', { name: 'Confirmar' }).click()
  await expect(folha.getByText('Não há nada a faturar nesta quinzena.')).toBeVisible()
  await expect(folha.getByLabel('Número da NF')).toHaveValue('1234')
  // Tenta de novo: o PDF já enviado é reaproveitado.
  await folha.getByRole('button', { name: 'Confirmar' }).click()
  await expect(page.getByText('Fatura nº 4 gerada.')).toBeVisible()
  expect(faturas.filter((c) => c.rpc === 'storage')).toHaveLength(1)
  const gerar = faturas.filter((c) => c.rpc === 'gerar_fatura')
  expect(gerar).toHaveLength(2)
  expect((gerar[0]!.corpo.p_nf as Record<string, unknown>).pdf_caminho).toBe((gerar[1]!.corpo.p_nf as Record<string, unknown>).pdf_caminho)
})

test('"Marcar como paga" com a data (hoje por padrão)', async ({ page }) => {
  const { faturas } = await abrir(page, `/adm/faturas/${UMI}`)
  const f2 = page.getByRole('list', { name: 'Faturas da empresa' }).locator(':scope > li').filter({ hasText: 'Fatura nº 2' })
  await f2.getByRole('button', { name: 'Marcar como paga' }).click()
  const folha = page.getByRole('dialog', { name: 'Marcar como paga' })
  await expect(folha.getByLabel('Data do pagamento')).toHaveValue(hoje())
  await expect(folha.getByLabel('Data do pagamento')).toHaveAttribute('max', hoje())
  await folha.getByLabel('Data do pagamento').fill(somarDias(hoje(), 1))
  await folha.getByRole('button', { name: 'Confirmar pagamento' }).click()
  await expect(folha.getByText('A data do pagamento não pode ser no futuro.')).toBeVisible()
  expect(faturas.filter((c) => c.rpc === 'marcar_fatura_paga')).toHaveLength(0)
  await folha.getByLabel('Data do pagamento').fill('2026-10-20')
  await folha.getByRole('button', { name: 'Confirmar pagamento' }).click()
  await expect(page.getByText('Fatura nº 2 marcada como paga.')).toBeVisible()
  expect(faturas.find((c) => c.rpc === 'marcar_fatura_paga')!.corpo).toEqual({ p_fatura: F2, p_paga_em: '2026-10-20' })
})

test('"Cancelar fatura" exige o motivo (3 a 200) e manda o motivo aparado', async ({ page }) => {
  const { faturas } = await abrir(page, `/adm/faturas/${UMI}`)
  const f2 = page.getByRole('list', { name: 'Faturas da empresa' }).locator(':scope > li').filter({ hasText: 'Fatura nº 2' })
  await f2.getByRole('button', { name: 'Cancelar fatura' }).click()
  const folha = page.getByRole('dialog', { name: 'Cancelar fatura' })
  await folha.getByLabel('Motivo').fill('ab')
  await folha.getByRole('button', { name: 'Confirmar cancelamento' }).click()
  await expect(folha.getByText('Informe o motivo (de 3 a 200 caracteres).')).toBeVisible()
  expect(faturas.filter((c) => c.rpc === 'cancelar_fatura')).toHaveLength(0)
  await folha.getByLabel('Motivo').fill('  NF cancelada na prefeitura  ')
  await folha.getByRole('button', { name: 'Confirmar cancelamento' }).click()
  await expect(page.getByText('Fatura nº 2 cancelada. Os itens voltaram para o A faturar.')).toBeVisible()
  expect(faturas.find((c) => c.rpc === 'cancelar_fatura')!.corpo).toEqual({ p_fatura: F2, p_motivo: 'NF cancelada na prefeitura' })
})

test('"Trocar PDF" sobe o PDF novo e depois troca o caminho', async ({ page }) => {
  const { faturas } = await abrir(page, `/adm/faturas/${UMI}`)
  const f2 = page.getByRole('list', { name: 'Faturas da empresa' }).locator(':scope > li').filter({ hasText: 'Fatura nº 2' })
  await f2.getByRole('button', { name: 'Trocar PDF' }).click()
  const folha = page.getByRole('dialog', { name: 'Trocar PDF' })
  await folha.getByLabel('PDF da NF').setInputFiles(PDF)
  await folha.getByRole('button', { name: 'Enviar PDF' }).click()
  await expect(page.getByText('PDF da fatura nº 2 trocado.')).toBeVisible()
  const iUpload = faturas.findIndex((c) => c.rpc === 'storage')
  const iTrocar = faturas.findIndex((c) => c.rpc === 'trocar_pdf_fatura')
  expect(iUpload).toBeGreaterThanOrEqual(0)
  expect(iTrocar).toBeGreaterThan(iUpload)
  expect(faturas[iTrocar]!.corpo.p_fatura).toBe(F2)
  expect(String(faturas[iTrocar]!.corpo.p_caminho)).toMatch(new RegExp(`^${UMI}/[0-9a-f-]{36}\\.pdf$`))
})

test('"Baixar NF (PDF)" abre o link assinado da NF', async ({ page, context }) => {
  const { faturas } = await abrir(page, `/adm/faturas/${UMI}`)
  const f2 = page.getByRole('list', { name: 'Faturas da empresa' }).locator(':scope > li').filter({ hasText: 'Fatura nº 2' })
  // A aba nova não herda as rotas da página: o contexto serve o link (HTML, para o Chromium sem leitor de PDF não baixar).
  await context.route(`${URL_SUPABASE}/storage/v1/object/sign/notas-fiscais/**`, (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: '<title>NF</title>' }),
  )
  const nova = context.waitForEvent('page')
  await f2.getByRole('button', { name: 'Baixar NF (PDF)' }).click()
  const aba = await nova
  await expect.poll(() => aba.url()).toContain(`/storage/v1/object/sign/notas-fiscais/${UMI}/nota-2.pdf`)
  expect(String(faturas.find((c) => c.rpc === 'link')!.corpo.url)).toContain(`/notas-fiscais/${UMI}/nota-2.pdf`)
})

// ------------------------------------------------------------------------------------------------
// Créditos e acesso
// ------------------------------------------------------------------------------------------------

test('Créditos: a empresa no Faturado tem a etiqueta "Faturado (NF)" e não tem Recarga', async ({ page }) => {
  await abrir(page, '/adm/creditos', { saldos: [saldoFalso({ forma_cobranca: 'FATURADO' })] })
  const umi = page.getByTestId('credito-empresa').filter({ hasText: 'Umi San' })
  const porto = page.getByTestId('credito-empresa').filter({ hasText: 'Porto Azul' })
  await expect(umi).toContainText('Faturado (NF)')
  await expect(porto).not.toContainText('Faturado (NF)')
  await umi.click()
  await expect(page.getByRole('button', { name: 'Ajuste' })).toBeVisible()
  await expect(page.getByText('Faturado (NF)')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Recarga' })).toHaveCount(0)
})

test('Créditos: a empresa no Crédito continua com a Recarga', async ({ page }) => {
  await abrir(page, `/adm/creditos/${UMI}`, { saldos: [saldoFalso({ forma_cobranca: 'CREDITO' })] })
  await expect(page.getByRole('button', { name: 'Recarga' })).toBeVisible()
  await expect(page.getByText('Faturado (NF)')).toHaveCount(0)
})

test('N1 não acessa adm/faturas', async ({ page }) => {
  const { faturas } = await abrir(page, '/adm/faturas', { perfil: N1 })
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Faturas', level: 1 })).toHaveCount(0)
  await page.goto(`/adm/faturas/${UMI}`)
  await expect(page).toHaveURL(/\/$/)
  expect(faturas.filter((c) => c.rpc === 'faturas_resumo' || c.rpc === 'faturas')).toHaveLength(0)
})
