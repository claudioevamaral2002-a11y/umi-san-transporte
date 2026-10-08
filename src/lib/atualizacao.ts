/** Rotas em que recarregar sozinho é seguro (nenhum formulário longo em andamento). */
const ROTAS_RECARREGAVEIS = ['/', '/entrar', '/definir-senha', '/seguranca/2fa']

export function podeRecarregarSozinho(caminho: string): boolean {
  return ROTAS_RECARREGAVEIS.includes(caminho)
}

/**
 * Quando um service worker novo assume o controle (deploy novo), recarrega uma vez para que o app
 * rode no shell novo. `location.reload()` mantém o fragmento (#access_token…) do link de acesso.
 * Não recarrega na primeira instalação (sem controlador anterior) nem no meio de formulários.
 */
export function recarregarQuandoNovoServiceWorkerAssumir(): void {
  if (!('serviceWorker' in navigator)) return
  const tinhaControlador = Boolean(navigator.serviceWorker.controller)
  let recarregou = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinhaControlador || recarregou) return
    if (!podeRecarregarSozinho(window.location.pathname)) return
    recarregou = true
    window.location.reload()
  })
}

/** Apaga os caches, desregistra os service workers e recarrega (tela de erro → "Recarregar"). */
export async function recarregarLimpo(): Promise<void> {
  try {
    if ('caches' in window) await Promise.all((await caches.keys()).map((chave) => caches.delete(chave)))
    if ('serviceWorker' in navigator) {
      await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()))
    }
  } finally {
    window.location.reload()
  }
}
