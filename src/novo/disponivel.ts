// "Disponível para chamadas" (motorista): preferência só deste aparelho, no MVP. Não vai ao banco e não compartilha
// a localização (especificação §3 e §6.7). A Tarefa 10 lê esta preferência para tocar ou não as chamadas.
export const CHAVE_DISPONIVEL = 'ivo:disponivel'

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
}
