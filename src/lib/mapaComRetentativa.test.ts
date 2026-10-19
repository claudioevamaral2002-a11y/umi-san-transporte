import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessaoTilesComRetentativa } from './mapaComRetentativa.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const SESSAO = { session: 's', urlTile: 'u' }

describe('sessaoTilesComRetentativa', () => {
  it('2 falhas e 1 sucesso: avisa com a sessão no 3º ciclo, de 15 em 15 s', async () => {
    const criar = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(SESSAO)
    const aoMudar = vi.fn()
    sessaoTilesComRetentativa('K', aoMudar, 15000, criar)
    await vi.advanceTimersByTimeAsync(0)
    expect(criar).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(14999)
    expect(criar).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(criar).toHaveBeenCalledTimes(2)
    expect(aoMudar).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15000)
    expect(aoMudar).toHaveBeenCalledWith(SESSAO)
    await vi.advanceTimersByTimeAsync(60000)
    expect(criar).toHaveBeenCalledTimes(3)
  })
  it('cancelar interrompe as tentativas', async () => {
    const criar = vi.fn().mockResolvedValue(null)
    const cancelar = sessaoTilesComRetentativa('K', vi.fn(), 15000, criar)
    await vi.advanceTimersByTimeAsync(0)
    cancelar()
    await vi.advanceTimersByTimeAsync(60000)
    expect(criar).toHaveBeenCalledTimes(1)
  })
  it('cancelar com chamada em andamento não avisa', async () => {
    let fim: (v: typeof SESSAO) => void = () => {}
    const criar = vi.fn().mockReturnValue(new Promise((r) => (fim = r)))
    const aoMudar = vi.fn()
    const cancelar = sessaoTilesComRetentativa('K', aoMudar, 15000, criar)
    cancelar()
    fim(SESSAO)
    await vi.advanceTimersByTimeAsync(0)
    expect(aoMudar).not.toHaveBeenCalled()
  })
})
