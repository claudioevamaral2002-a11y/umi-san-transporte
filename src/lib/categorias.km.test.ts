import { describe, expect, it } from 'vitest'
import { kmDaRota, toleranciaKm } from './categorias.ts'

describe('km da rota', () => {
  it('uma casa, meio para cima', () => {
    expect(kmDaRota(42.37)).toBe(42.4)
    expect(kmDaRota(42.34)).toBe(42.3)
  })
  it('tolerância: 1 km ou 1% da rota, o maior', () => {
    expect(toleranciaKm(42)).toBe(1)
    expect(toleranciaKm(250)).toBe(2.5)
  })
})
