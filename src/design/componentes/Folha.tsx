import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icone } from './Icone.tsx'

/**
 * Folha (bottom sheet no celular, diálogo centralizado no desktop) sobre `<dialog>` modal:
 * o resto da página fica inerte (foco preso na folha), Esc fecha e o foco volta para quem abriu.
 * O conteúdo só é montado aberto (formulários começam limpos a cada abertura).
 */
export function Folha({
  aberta,
  titulo,
  sobretitulo,
  onFechar,
  children,
  largura = 'md:max-w-lg',
}: {
  aberta: boolean
  titulo: string
  sobretitulo?: string
  onFechar: () => void
  children: ReactNode
  largura?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const anterior = useRef<HTMLElement | null>(null)
  const fechar = useRef(onFechar)
  const id = useId()

  useEffect(() => {
    fechar.current = onFechar
  })

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (aberta && !d.open) {
      anterior.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      d.showModal()
    } else if (!aberta && d.open) {
      d.close()
    }
  }, [aberta])

  // Fechada por Esc, pelo botão ou ao desmontar a tela: devolve o foco a quem abriu.
  useEffect(() => {
    const d = ref.current
    return () => {
      if (d?.open) d.close()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-titulo`}
      onClose={() => {
        const voltar = anterior.current
        anterior.current = null
        if (voltar?.isConnected) voltar.focus()
        fechar.current()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close()
      }}
      className={`m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-[22px] border-[1.5px] border-borda bg-superficie p-0 text-texto backdrop:bg-marinho/60 md:m-auto md:rounded-[18px] ${largura}`}
    >
      {aberta && (
        <div className="space-y-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 pt-1">
              {sobretitulo && <p className="ivo-sobretitulo text-texto-suave">{sobretitulo}</p>}
              <h2 id={`${id}-titulo`} className="ivo-h3">
                {titulo}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => ref.current?.close()}
              aria-label="Fechar"
              className="-mt-1 -mr-2 flex size-12 shrink-0 items-center justify-center rounded-xl text-texto-suave hover:bg-borda/60"
            >
              <Icone nome="fechar" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}
