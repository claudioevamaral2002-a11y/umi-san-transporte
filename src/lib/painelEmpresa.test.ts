import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PedidoPainel } from './painelEmpresa.ts'

const rpc = vi.fn()
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const { CABECALHO_CSV, csvDoMes, painelEmpresa, rotuloStatus } = await import('./painelEmpresa.ts')

beforeEach(() => rpc.mockReset())

const pedido = (extra: Partial<PedidoPainel> = {}): PedidoPainel => ({
  id: 'p1',
  numero: 42,
  solicitante_nome: 'Marina Souza',
  inicio: '2026-10-22T11:30:00Z',
  fim_previsto: '2026-10-22T12:25:00Z',
  origem: 'Umi San · Rua Araguaia, 49',
  destino: 'Porto de Itajaí · Portão 3',
  categoria_nome: 'IVO Passageiros',
  centro_custo: 'Operações 4.100',
  status: 'CONCLUIDA',
  valor_cent: 22000,
  estimado: false,
  ...extra,
})

describe('rotuloStatus', () => {
  it('EM_ANDAMENTO é "A caminho"', () => {
    expect(rotuloStatus('EM_ANDAMENTO')).toBe('A caminho')
  })
  it('cada situação com o rótulo do painel', () => {
    expect(
      (['SOLICITADA', 'ORCADA', 'AGENDADA', 'CONCLUIDA', 'CANCELADA', 'RECUSADA', 'REPROVADA', 'EXPIRADA'] as const).map(
        rotuloStatus,
      ),
    ).toEqual(['Aguardando o Ivo', 'Para confirmar', 'Agendada', 'Concluída', 'Cancelada', 'Recusada', 'Reprovada', 'Expirada'])
  })
})

describe('csvDoMes', () => {
  it('cabeçalho exato e uma linha por corrida (data e valor no formato brasileiro)', () => {
    expect(CABECALHO_CSV).toBe('Data;Quem pediu;De;Paradas;Para;Categoria;Horas;Centro de custo;Valor')
    expect(csvDoMes([pedido()])).toBe(
      'Data;Quem pediu;De;Paradas;Para;Categoria;Horas;Centro de custo;Valor\r\n' +
        '22/10/2026;Marina Souza;Umi San · Rua Araguaia, 49;;Porto de Itajaí · Portão 3;IVO Passageiros;;Operações 4.100;220,00\r\n',
    )
  })
  it('";" no centro de custo vai entre aspas (e as aspas de dentro dobram)', () => {
    const linha = csvDoMes([pedido({ centro_custo: 'Obra; "Galpão" 2' })]).split('\r\n')[1]
    expect(linha).toBe(
      '22/10/2026;Marina Souza;Umi San · Rua Araguaia, 49;;Porto de Itajaí · Portão 3;IVO Passageiros;;"Obra; ""Galpão"" 2";220,00',
    )
  })
  it('texto que a planilha leria como fórmula ganha um apóstrofo', () => {
    const linha = csvDoMes([pedido({ centro_custo: '=SOMA(A1)' })]).split('\r\n')[1]
    expect(linha?.split(';')[7]).toBe("'=SOMA(A1)")
  })
  it('paradas separadas por barra e horas com vírgula', () => {
    const linha = csvDoMes([pedido({ paradas: ['Posto', 'Cliente'], horas_estimadas: 2.5 })]).split('\r\n')[1]
    expect(linha).toBe(
      '22/10/2026;Marina Souza;Umi San · Rua Araguaia, 49;Posto | Cliente;Porto de Itajaí · Portão 3;IVO Passageiros;2,5;Operações 4.100;220,00',
    )
  })
  it('sem valor (cancelada sem multa) fica de fora; campos vazios ficam vazios', () => {
    const csv = csvDoMes([
      pedido({ id: 'a', valor_cent: null, status: 'CANCELADA' }),
      pedido({ id: 'b', centro_custo: null, categoria_nome: null, solicitante_nome: null, valor_cent: 3300 }),
    ])
    expect(csv.split('\r\n')).toEqual([
      CABECALHO_CSV,
      '22/10/2026;;Umi San · Rua Araguaia, 49;;Porto de Itajaí · Portão 3;;;;33,00',
      '',
    ])
  })
})

describe('painelEmpresa.ler', () => {
  it('chama api.painel_empresa com a empresa e o mês', async () => {
    rpc.mockResolvedValue({ data: { ok: true, resumo: {}, proximas: [], recentes: [], do_mes: [], pessoas: {} }, error: null })
    await painelEmpresa.ler('e1', '2026-10-01')
    expect(rpc).toHaveBeenCalledWith('painel_empresa', { p_empresa: 'e1', p_mes: '2026-10-01' })
  })
  it('o N1 chama sem empresa (o banco usa a dele)', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await painelEmpresa.ler()
    expect(rpc).toHaveBeenCalledWith('painel_empresa', { p_empresa: null, p_mes: null })
  })
  it('negado: erro de leitura com o código', async () => {
    rpc.mockResolvedValue({ data: { ok: false, codigo: 'SEM_PERMISSAO' }, error: null })
    await expect(painelEmpresa.ler()).rejects.toMatchObject({ codigo: 'SEM_PERMISSAO' })
  })
})
