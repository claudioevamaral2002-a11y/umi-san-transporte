/// <reference types="vite-plugin-pwa/react" />
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Botao } from '../design/componentes/Botao.tsx'

/**
 * Aviso de deploy novo (registerType 'prompt'): o SW novo fica esperando até a pessoa tocar em
 * "Atualizar"; aí ele assume e a página recarrega no shell novo. Nada de app instalado preso numa
 * versão antiga: ao voltar para o app (aba visível de novo), o navegador procura um SW novo.
 */
export function AvisoNovaVersao() {
  const {
    needRefresh: [temVersaoNova],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registro) {
      if (!registro) return
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registro.update().catch(() => undefined)
      })
    },
  })

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      {temVersaoNova && (
        <Botao
          variante="principal"
          className="pointer-events-auto shadow-lg"
          onClick={() => void updateServiceWorker(true)}
        >
          Nova versão · Atualizar
        </Botao>
      )}
    </div>
  )
}
