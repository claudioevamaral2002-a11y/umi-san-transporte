// Rótulos de papel e nível. O app atual usa os de sempre (administracao.ts); o app novo troca pelos que o dono pediu
// (Ruling R13, 19/10: "master que pode editar tabela; motorista; cliente: Visualizador, Solicitante, Administrador").
// Só o texto muda: o banco e as permissões continuam os mesmos. As telas do app atual reusadas no app novo leem daqui.
import { createContext, useContext, type ReactNode } from 'react'
import { NIVEIS, PAPEIS } from './administracao.ts'
import type { Nivel, Papel } from './estadoSessao.ts'

export interface Rotulos {
  papeis: Record<Papel, string>
  niveis: Record<Nivel, string>
}

export const ROTULOS_APP_ATUAL: Rotulos = { papeis: PAPEIS, niveis: NIVEIS }

export const ROTULOS_APP_NOVO: Rotulos = {
  papeis: { ...PAPEIS, ADM: 'Master' },
  niveis: { 1: 'Administrador', 2: 'Solicitante', 3: 'Visualizador' },
}

const Contexto = createContext<Rotulos>(ROTULOS_APP_ATUAL)

export function ProvedorRotulos({ rotulos, children }: { rotulos: Rotulos; children: ReactNode }) {
  return <Contexto value={rotulos}>{children}</Contexto>
}

export function useRotulos(): Rotulos {
  return useContext(Contexto)
}

/** "Master", "Motorista", ou o nível do cliente ("Administrador"…); sem nível, "Cliente". */
export function rotuloCurto(r: Rotulos, papel: Papel, nivel: Nivel | null | undefined): string {
  if (papel !== 'CLIENTE') return r.papeis[papel]
  return nivel ? r.niveis[nivel] : r.papeis.CLIENTE
}
