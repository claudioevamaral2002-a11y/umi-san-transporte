import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Fatura, ItemFatura } from './faturas.ts'

const rpc = vi.fn()
const upload = vi.fn()
const createSignedUrl = vi.fn()
const from = vi.fn(() => ({ upload, createSignedUrl }))
// No CI não há VITE_SUPABASE_URL para os testes de unidade: o cliente é simulado.
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), storage: { from } } }))

const {
  MAX_PDF_BYTES,
  ROTULO_SITUACAO,
  csvDaFatura,
  enviarPdfNota,
  faturas,
  linkNota,
  quinzenaDe,
  rotuloQuinzena,
  ultimaQuinzenaFechada,
  vencimentoPadrao,
} = await import('./faturas.ts')
const { CABECALHO_CSV } = await import('./painelEmpresa.ts')

beforeEach(() => {
  rpc.mockReset()
  upload.mockReset()
  createSignedUrl.mockReset()
  from.mockClear()
})

describe('quinzenaDe (America/Sao_Paulo)', () => {
  it('15/10 às 23h30 em Brasília (16/10 02h30 UTC) ainda é a quinzena de 1 a 15', () => {
    expect(quinzenaDe(new Date('2026-10-16T02:30:00Z'))).toEqual({ inicio: '2026-10-01', fim: '2026-10-15' })
  })
  it('16/10 00h30 em Brasília já é a segunda quinzena, até o último dia', () => {
    expect(quinzenaDe(new Date('2026-10-16T03:30:00Z'))).toEqual({ inicio: '2026-10-16', fim: '2026-10-31' })
  })
  it('fevereiro: 16 a 28 em 2027 e 16 a 29 em 2028 (bissexto)', () => {
    expect(quinzenaDe(new Date('2027-02-16T15:00:00Z'))).toEqual({ inicio: '2027-02-16', fim: '2027-02-28' })
    expect(quinzenaDe(new Date('2028-02-20T15:00:00Z'))).toEqual({ inicio: '2028-02-16', fim: '2028-02-29' })
  })
  it('virada de mês: 31/10 23h em Brasília (01/11 UTC) ainda é outubro', () => {
    expect(quinzenaDe(new Date('2026-11-01T02:00:00Z'))).toEqual({ inicio: '2026-10-16', fim: '2026-10-31' })
  })
})

describe('ultimaQuinzenaFechada', () => {
  it('em 01/11: 16/10 a 31/10', () => {
    expect(ultimaQuinzenaFechada(new Date('2026-11-01T12:00:00Z'))).toEqual({ inicio: '2026-10-16', fim: '2026-10-31' })
  })
  it('em 20/10: 01/10 a 15/10', () => {
    expect(ultimaQuinzenaFechada(new Date('2026-10-20T12:00:00Z'))).toEqual({ inicio: '2026-10-01', fim: '2026-10-15' })
  })
  it('em janeiro, volta para a segunda quinzena de dezembro do ano anterior', () => {
    expect(ultimaQuinzenaFechada(new Date('2027-01-05T12:00:00Z'))).toEqual({ inicio: '2026-12-16', fim: '2026-12-31' })
  })
  it('em 01/11 00h30 de Brasília (03h30 UTC) a quinzena de outubro já fechou; às 23h30 de 31/10, não', () => {
    expect(ultimaQuinzenaFechada(new Date('2026-11-01T03:30:00Z')).fim).toBe('2026-10-31')
    expect(ultimaQuinzenaFechada(new Date('2026-11-01T02:30:00Z')).fim).toBe('2026-10-15')
  })
})

describe('vencimentoPadrao', () => {
  it('emissão + 30 dias', () => {
    expect(vencimentoPadrao('2026-10-16')).toBe('2026-11-15')
    expect(vencimentoPadrao('2027-02-01')).toBe('2027-03-03')
    expect(vencimentoPadrao('2026-12-15')).toBe('2027-01-14')
  })
})

describe('rótulos', () => {
  it('situações com o texto da interface', () => {
    expect(ROTULO_SITUACAO).toEqual({ ABERTA: 'Aberta', VENCIDA: 'Vencida', PAGA: 'Paga', CANCELADA: 'Cancelada' })
  })
  it('quinzena por extenso curto', () => {
    expect(rotuloQuinzena({ inicio: '2026-10-16', fim: '2026-10-31' })).toBe('16/10 a 31/10/2026')
  })
})

const arquivo = (nome: string, tipo: string, bytes: number) => {
  const f = new File(['x'], nome, { type: tipo })
  Object.defineProperty(f, 'size', { value: bytes })
  return f
}

describe('enviarPdfNota', () => {
  it('recusa um .png sem chamar o storage', async () => {
    expect(await enviarPdfNota('emp-1', arquivo('nota.png', 'image/png', 1000))).toEqual({ ok: false, codigo: 'PDF_INVALIDO' })
    expect(from).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })
  it('recusa um PDF de 6 MB sem chamar o storage', async () => {
    expect(await enviarPdfNota('emp-1', arquivo('nota.pdf', 'application/pdf', 6 * 1024 * 1024))).toEqual({
      ok: false,
      codigo: 'PDF_INVALIDO',
    })
    expect(upload).not.toHaveBeenCalled()
  })
  it('recusa o arquivo vazio', async () => {
    expect((await enviarPdfNota('emp-1', arquivo('nota.pdf', 'application/pdf', 0))).ok).toBe(false)
    expect(upload).not.toHaveBeenCalled()
  })
  it('envia o PDF para notas-fiscais/<empresa>/<uuid>.pdf e devolve o caminho', async () => {
    upload.mockResolvedValue({ data: { path: 'x' }, error: null })
    const r = await enviarPdfNota('emp-1', arquivo('nota.pdf', 'application/pdf', MAX_PDF_BYTES))
    expect(from).toHaveBeenCalledWith('notas-fiscais')
    expect(r.ok).toBe(true)
    const caminho = r.ok ? r.caminho : ''
    expect(caminho).toMatch(/^emp-1\/[0-9a-f-]{36}\.pdf$/)
    expect(upload).toHaveBeenCalledWith(caminho, expect.any(File), { contentType: 'application/pdf', upsert: false })
  })
  it('falha do storage vira ERRO_INESPERADO', async () => {
    upload.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect(await enviarPdfNota('emp-1', arquivo('nota.pdf', 'application/pdf', 100))).toEqual({ ok: false, codigo: 'ERRO_INESPERADO' })
    upload.mockRejectedValue(new Error('rede'))
    expect(await enviarPdfNota('emp-1', arquivo('nota.pdf', 'application/pdf', 100))).toEqual({ ok: false, codigo: 'ERRO_INESPERADO' })
  })
})

describe('linkNota', () => {
  it('link assinado de 60 s', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/assinado' }, error: null })
    expect(await linkNota('emp-1/a.pdf')).toBe('https://x/assinado')
    expect(from).toHaveBeenCalledWith('notas-fiscais')
    expect(createSignedUrl).toHaveBeenCalledWith('emp-1/a.pdf', 60)
  })
  it('com `baixar`, o link pede o anexo (download)', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://x/assinado?download=' }, error: null })
    expect(await linkNota('emp-1/a.pdf', { baixar: true })).toBe('https://x/assinado?download=')
    expect(createSignedUrl).toHaveBeenCalledWith('emp-1/a.pdf', 60, { download: true })
  })
  it('sem permissão: erro de leitura', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'negado' } })
    await expect(linkNota('emp-2/a.pdf')).rejects.toThrow()
  })
})

describe('faturas (RPCs)', () => {
  beforeEach(() => rpc.mockResolvedValue({ data: { ok: true }, error: null }))
  it('prévia, leitura e resumo', async () => {
    await faturas.previa('emp-1', '2026-10-01', '2026-10-15')
    expect(rpc).toHaveBeenLastCalledWith('previa_fatura', { p_empresa: 'emp-1', p_inicio: '2026-10-01', p_fim: '2026-10-15' })
    await faturas.listar('emp-1')
    expect(rpc).toHaveBeenLastCalledWith('faturas', { p_empresa: 'emp-1' })
    await faturas.listar()
    expect(rpc).toHaveBeenLastCalledWith('faturas', { p_empresa: null })
    await faturas.ler('fat-1')
    expect(rpc).toHaveBeenLastCalledWith('fatura', { p_fatura: 'fat-1' })
    await faturas.resumo()
    expect(rpc).toHaveBeenLastCalledWith('faturas_resumo', {})
  })
  it('gerar manda a NF; o vencimento só quando informado', async () => {
    await faturas.gerar('emp-1', '2026-10-01', '2026-10-15', {
      numero: ' 123 ',
      emitida_em: '2026-10-16',
      pdf_caminho: 'emp-1/a.pdf',
    })
    expect(rpc).toHaveBeenLastCalledWith('gerar_fatura', {
      p_empresa: 'emp-1',
      p_inicio: '2026-10-01',
      p_fim: '2026-10-15',
      p_nf: { numero: '123', emitida_em: '2026-10-16', pdf_caminho: 'emp-1/a.pdf' },
    })
    await faturas.gerar('emp-1', '2026-10-01', '2026-10-15', {
      numero: '123',
      emitida_em: '2026-10-16',
      pdf_caminho: 'emp-1/a.pdf',
      vencimento: '2026-11-20',
    })
    expect(rpc).toHaveBeenLastCalledWith(
      'gerar_fatura',
      expect.objectContaining({
        p_nf: { numero: '123', emitida_em: '2026-10-16', pdf_caminho: 'emp-1/a.pdf', vencimento: '2026-11-20' },
      }),
    )
  })
  it('marcar como paga, cancelar e trocar o PDF', async () => {
    await faturas.marcarPaga('fat-1', '2026-11-10')
    expect(rpc).toHaveBeenLastCalledWith('marcar_fatura_paga', { p_fatura: 'fat-1', p_paga_em: '2026-11-10' })
    await faturas.cancelar('fat-1', ' NF cancelada na prefeitura ')
    expect(rpc).toHaveBeenLastCalledWith('cancelar_fatura', { p_fatura: 'fat-1', p_motivo: 'NF cancelada na prefeitura' })
    await faturas.trocarPdf('fat-1', 'emp-1/b.pdf')
    expect(rpc).toHaveBeenLastCalledWith('trocar_pdf_fatura', { p_fatura: 'fat-1', p_caminho: 'emp-1/b.pdf' })
  })
  it('leitura recusada vira erro', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'SEM_PERMISSAO' }, error: null })
    await expect(faturas.listar('emp-1')).rejects.toThrow('SEM_PERMISSAO')
  })
})

describe('csvDaFatura', () => {
  const fatura: Fatura = {
    id: 'fat-1',
    numero: 3,
    inicio: '2026-10-01',
    fim: '2026-10-15',
    total_cent: 27000,
    nf_numero: '123',
    nf_emitida_em: '2026-10-16',
    nf_pdf_caminho: 'emp-1/a.pdf',
    vencimento: '2026-11-15',
    status: 'ABERTA',
    situacao: 'ABERTA',
    paga_em: null,
  }
  const item = (extra: Partial<ItemFatura> = {}): ItemFatura => ({
    lancamento_id: 1,
    criado_em: '2026-10-10T13:00:00Z',
    tipo: 'DEBITO',
    valor_cent: -22000,
    numero: 42,
    solicitante_nome: 'Marina Souza',
    origem: 'Umi San',
    paradas: ['Posto'],
    destino: 'Porto',
    categoria_nome: 'IVO Passageiros',
    centro_custo: 'Operações',
    ...extra,
  })
  it('as colunas do CSV do mês, o valor cobrado positivo e a linha do total', () => {
    const csv = csvDaFatura(fatura, [item(), item({ lancamento_id: 2, tipo: 'MULTA', valor_cent: -5000, paradas: null, centro_custo: null })])
    expect(csv.split('\r\n')).toEqual([
      CABECALHO_CSV,
      '10/10/2026;Marina Souza;Umi San;Posto;Porto;IVO Passageiros;;Operações;220,00',
      '10/10/2026;Marina Souza;Umi San;;Porto;IVO Passageiros;;;50,00',
      'Total;;;;;;;;270,00',
      '',
    ])
  })
  it('estorno sai negativo e campo vazio fica vazio', () => {
    const csv = csvDaFatura(fatura, [item({ tipo: 'ESTORNO', valor_cent: 1000, solicitante_nome: null, origem: null, destino: null })])
    expect(csv.split('\r\n')[1]).toBe('10/10/2026;;;Posto;;IVO Passageiros;;Operações;-10,00')
  })
})
