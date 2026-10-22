// Fase 4: o mapa tenta criar a sessão de blocos de novo a cada 15 s enquanto falhar (rede ruim, cota), em vez de
// ficar indisponível até recarregar a tela.
import { criarSessaoTiles } from './mapaTiles.ts'

export type SessaoTiles = { session: string; urlTile: string }

/** Tenta já e, se falhar, a cada `intervaloMs`; avisa uma vez com a sessão e para. Devolve a função de cancelar. */
export function sessaoTilesComRetentativa(
  chave: string,
  aoMudar: (s: SessaoTiles) => void,
  intervaloMs = 15000,
  criar: (chave: string) => Promise<SessaoTiles | null> = criarSessaoTiles,
): () => void {
  let cancelado = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tentar = async () => {
    const s = await criar(chave)
    if (cancelado) return
    if (s) {
      aoMudar(s)
      return
    }
    timer = setTimeout(() => void tentar(), intervaloMs)
  }
  void tentar()
  return () => {
    cancelado = true
    if (timer !== undefined) clearTimeout(timer)
  }
}
