import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
// No CI não há VITE_SUPABASE_URL para os testes de unidade: o cliente é simulado.
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const { ajudaCliente, contatoIvo, linkContato } = await import('./ajuda.ts')
const { ErroLeitura } = await import('./pedidos.ts')

beforeEach(() => rpc.mockReset())

const FAIXAS = [
  { antecedencia_min_horas: 24, multa_bp: 0 },
  { antecedencia_min_horas: 0, multa_bp: 10000 },
]

describe('contatoIvo (v2.2)', () => {
  it('devolve o contato aparado; vazio ou nulo = null', async () => {
    rpc.mockResolvedValue({ data: { ok: true, contato: ' (47) 99999-0000 ' }, error: null })
    expect(await contatoIvo()).toBe('(47) 99999-0000')
    expect(rpc).toHaveBeenCalledWith('contato_ivo', {})
    rpc.mockResolvedValue({ data: { ok: true, contato: null }, error: null })
    expect(await contatoIvo()).toBeNull()
    rpc.mockResolvedValue({ data: { ok: true, contato: '  ' }, error: null })
    expect(await contatoIvo()).toBeNull()
  })
})

describe('ajudaCliente (v2.2)', () => {
  it('traz as faixas do contrato, os prazos e a forma de cobrança', async () => {
    rpc.mockResolvedValue({
      data: {
        ok: true,
        cancelamento: { faixas_cancelamento: FAIXAS },
        prazo_orcar_horas: 12,
        validade_orcamento_horas: 48,
        forma_cobranca: 'FATURADO',
      },
      error: null,
    })
    expect(await ajudaCliente()).toEqual({
      faixas_cancelamento: FAIXAS,
      prazo_orcar_horas: 12,
      validade_orcamento_horas: 48,
      forma_cobranca: 'FATURADO',
    })
    expect(rpc).toHaveBeenCalledWith('ajuda_cliente', {})
  })
  it('aceita as faixas soltas ou em `faixas`', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, cancelamento: FAIXAS, prazo_orcar_horas: 12, validade_orcamento_horas: 48, forma_cobranca: 'CREDITO' },
      error: null,
    })
    expect((await ajudaCliente())?.faixas_cancelamento).toEqual(FAIXAS)
    rpc.mockResolvedValue({
      data: { ok: true, cancelamento: { faixas: FAIXAS }, prazo_orcar_horas: 12, validade_orcamento_horas: 48 },
      error: null,
    })
    const r = await ajudaCliente()
    expect(r?.faixas_cancelamento).toEqual(FAIXAS)
    expect(r?.forma_cobranca).toBe('CREDITO')
  })
  it('sem contrato vigente: null; outra recusa: ErroLeitura', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'SEM_CONTRATO' }, error: null })
    expect(await ajudaCliente()).toBeNull()
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'SEM_PERMISSAO' }, error: null })
    await expect(ajudaCliente()).rejects.toBeInstanceOf(ErroLeitura)
  })
})

describe('linkContato (v2.2)', () => {
  it('telefone com 10 ou 11 dígitos → tel: com +55', () => {
    expect(linkContato('(47) 99999-0000')).toBe('tel:+5547999990000')
    expect(linkContato('4733334444')).toBe('tel:+554733334444')
    expect(linkContato('+55 47 99999-0000')).toBe('tel:+5547999990000')
  })
  it('wa.me e https://wa.me → o link do WhatsApp', () => {
    expect(linkContato('wa.me/5547999990000')).toBe('https://wa.me/5547999990000')
    expect(linkContato('https://wa.me/5547999990000')).toBe('https://wa.me/5547999990000')
  })
  it('qualquer outra coisa → null', () => {
    expect(linkContato('')).toBeNull()
    expect(linkContato('99999-0000')).toBeNull()
    expect(linkContato('+1 415 555 0100')).toBeNull()
    expect(linkContato('ivo@exemplo.com')).toBeNull()
    expect(linkContato('http://wa.me/5547999990000')).toBeNull()
    expect(linkContato('https://wa.me.golpe.com/1')).toBeNull()
    expect(linkContato('fale com o Ivo')).toBeNull()
  })
})
