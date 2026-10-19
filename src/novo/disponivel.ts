// "Disponível para chamadas" (motorista): preferência só deste aparelho, no MVP. Não vai ao banco e não compartilha
// a localização (especificação §3 e §6.7). O início do motorista lê esta preferência para tocar ou não as chamadas.
import { useSyncExternalStore } from 'react'

export const CHAVE_DISPONIVEL = 'ivo:disponivel'
/** Avisa as telas abertas quando o interruptor do menu muda (o evento `storage` só chega às outras abas). */
const EVENTO = 'ivo:disponivel-mudou'

/** Ligado por padrão (o Ivo é o único motorista: perder uma chamada custa mais). Sem armazenamento, ligado. */
export function lerDisponivel(): boolean {
  try {
    return localStorage.getItem(CHAVE_DISPONIVEL) !== '0'
  } catch {
    return true
  }
}

export function gravarDisponivel(ligado: boolean): void {
  try {
    localStorage.setItem(CHAVE_DISPONIVEL, ligado ? '1' : '0')
  } catch {
    // Navegação privada ou armazenamento bloqueado: vale só enquanto a tela estiver aberta.
  }
  window.dispatchEvent(new Event(EVENTO))
}

function assinar(aoMudar: () => void): () => void {
  const naOutraAba = (e: StorageEvent) => {
    if (e.key === CHAVE_DISPONIVEL) aoMudar()
  }
  window.addEventListener(EVENTO, aoMudar)
  window.addEventListener('storage', naOutraAba)
  return () => {
    window.removeEventListener(EVENTO, aoMudar)
    window.removeEventListener('storage', naOutraAba)
  }
}

/** A preferência atual, acompanhando o interruptor do menu (nesta aba e nas outras). */
export function useDisponivel(): boolean {
  return useSyncExternalStore(assinar, lerDisponivel, () => true)
}
