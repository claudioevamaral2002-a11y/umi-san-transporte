import type { ReactNode } from 'react'

/**
 * Folha inferior sobre o mapa (mockups 1 e 2): cantos de 24 px, alça no topo e a ação da tela. No computador vira um
 * painel flutuante à esquerda, para o mapa continuar na frente. Rola por dentro quando o conteúdo passa de 75% da tela.
 */
export function FolhaMapa({ children, rotulo }: { children: ReactNode; rotulo?: string }) {
  return (
    <section
      aria-label={rotulo}
      data-testid="folha-mapa"
      className="ivo-folha-mapa fixed inset-x-0 bottom-0 z-10 max-h-[75dvh] overflow-y-auto overscroll-contain rounded-t-folha bg-superficie px-4 pt-2.5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-texto shadow-[0_-10px_30px_rgb(10_37_64/0.18)] md:inset-x-auto md:bottom-4 md:left-4 md:w-[26rem] md:rounded-folha md:pb-6"
    >
      <div data-testid="alca" aria-hidden="true" className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-borda" />
      {children}
    </section>
  )
}
