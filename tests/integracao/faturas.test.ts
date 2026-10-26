// v2.1, Tarefa 2 (docs/fases/v2-1-ajustes-faturamento-nf-desenho.md §4.3, §6): o PDF da NF no bucket privado
// notas-fiscais. O ADM envia e gera a fatura com o caminho; o N1 da empresa baixa por link assinado; o N2 e o N1 de
// outra empresa não conseguem.
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CONTRATO_TESTE, comBanco, criarPessoa, empresaNova, rpc } from './ajuda.ts'

/** PDF mínimo (o bucket só confere o tipo e o tamanho). */
function pdfMinimo(): Buffer {
  return Buffer.from(`%PDF-1.4\n% NF de teste ${randomUUID()}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`)
}

/** Empresa no Faturado desde 60 dias atrás, com um ajuste de R$ 123,45 há 20 dias (numa quinzena já fechada). */
async function empresaFaturada(): Promise<{ empresa: string; inicio: string; fim: string }> {
  const empresa = await empresaNova()
  return comBanco(async (db) => {
    await db.query(`select interno.inserir_contrato($1, $2::jsonb, now() - interval '60 days', null, 'Teste')`, [
      empresa,
      JSON.stringify({ ...CONTRATO_TESTE, forma_cobranca: 'FATURADO' }),
    ])
    await db.query(
      `insert into app.lancamentos (empresa_id, tipo, valor_cent, motivo, chave_idempotencia, criado_em)
       values ($1, 'AJUSTE', -12345, 'Teste', gen_random_uuid(), now() - interval '20 days')`,
      [empresa],
    )
    const q = await db.query<{ inicio: string; fim: string }>(
      'select inicio::text as inicio, fim::text as fim from interno.ultima_quinzena_fechada()',
    )
    return { empresa, ...q.rows[0]! }
  })
}

describe('NF da fatura (Storage notas-fiscais)', () => {
  it('ADM envia e gera; N1 da empresa baixa por link assinado; N2 e N1 de outra empresa não', async () => {
    const { empresa, inicio, fim } = await empresaFaturada()
    const adm = await criarPessoa({ papel: 'ADM' })
    const n1 = await criarPessoa({ papel: 'CLIENTE', nivel: 1, empresa })
    const n2 = await criarPessoa({ papel: 'CLIENTE', nivel: 2, empresa })
    const n1Outra = await criarPessoa({ papel: 'CLIENTE', nivel: 1, empresa: await empresaNova() })
    const caminho = `${empresa}/${randomUUID()}.pdf`
    const pdf = pdfMinimo()
    const opcoes = { contentType: 'application/pdf', upsert: false }

    // só o ADM envia
    expect((await n1.cliente.storage.from('notas-fiscais').upload(caminho, pdf, opcoes)).error).not.toBeNull()
    expect((await adm.cliente.storage.from('notas-fiscais').upload(caminho, pdf, opcoes)).error).toBeNull()

    const gerada = await rpc(adm, 'gerar_fatura', {
      p_empresa: empresa,
      p_inicio: inicio,
      p_fim: fim,
      p_nf: { numero: '2026/77', emitida_em: fim, pdf_caminho: caminho },
    })
    expect(gerada).toMatchObject({ ok: true, numero: 1 })

    // o N1 lê a fatura e baixa a NF
    const lidas = await rpc(n1, 'faturas', { p_empresa: null })
    expect(lidas.ok).toBe(true)
    const [fatura] = lidas.faturas as { id: string; total_cent: number; nf_pdf_caminho: string; situacao: string }[]
    expect(fatura).toMatchObject({ id: gerada.fatura, total_cent: 12345, nf_pdf_caminho: caminho })
    const assinada = await n1.cliente.storage.from('notas-fiscais').createSignedUrl(caminho, 60)
    expect(assinada.error).toBeNull()
    const resp = await fetch(assinada.data!.signedUrl)
    expect(resp.status).toBe(200)
    expect(Buffer.from(await resp.arrayBuffer()).equals(pdf)).toBe(true)

    // N2 da mesma empresa: nem a NF nem as faturas
    expect((await n2.cliente.storage.from('notas-fiscais').createSignedUrl(caminho, 60)).error).not.toBeNull()
    expect((await rpc(n2, 'faturas', { p_empresa: null })).codigo).toBe('SEM_PERMISSAO')

    // N1 de outra empresa: nem link nem download, e a fatura não abre
    expect((await n1Outra.cliente.storage.from('notas-fiscais').createSignedUrl(caminho, 60)).error).not.toBeNull()
    expect((await n1Outra.cliente.storage.from('notas-fiscais').download(caminho)).error).not.toBeNull()
    expect((await rpc(n1Outra, 'fatura', { p_fatura: gerada.fatura })).codigo).toBe('SEM_PERMISSAO')

    // ninguém apaga a NF (sem política de delete)
    await adm.cliente.storage.from('notas-fiscais').remove([caminho])
    expect((await n1.cliente.storage.from('notas-fiscais').download(caminho)).error).toBeNull()
  })

  it('bucket recusa o que não é PDF, acima de 5 MB e caminho fora do padrão', async () => {
    const empresa = await empresaNova()
    const adm = await criarPessoa({ papel: 'ADM' })
    const notas = adm.cliente.storage.from('notas-fiscais')

    const texto = await notas.upload(`${empresa}/${randomUUID()}.pdf`, Buffer.from('não é PDF'), {
      contentType: 'text/plain',
    })
    expect(texto.error).not.toBeNull()

    const grande = Buffer.concat([pdfMinimo(), Buffer.alloc(5 * 1024 * 1024 + 1)])
    const acima = await notas.upload(`${empresa}/${randomUUID()}.pdf`, grande, { contentType: 'application/pdf' })
    expect(acima.error).not.toBeNull()

    for (const caminho of [
      `${empresa}/nota.pdf`,
      `${empresa}/${randomUUID()}.txt`,
      `${empresa}/sub/${randomUUID()}.pdf`,
      `${randomUUID()}.pdf`,
      `${randomUUID()}/${randomUUID()}.pdf`, // empresa inexistente
    ]) {
      const r = await notas.upload(caminho, pdfMinimo(), { contentType: 'application/pdf' })
      expect(r.error, caminho).not.toBeNull()
    }
  })
})
