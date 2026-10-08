import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'

// Tipos mínimos da API explícita do Cloudflare Turnstile.
interface OpcoesTurnstile {
  sitekey: string
  action?: string
  theme?: 'auto' | 'light' | 'dark'
  size?: 'normal' | 'flexible' | 'compact'
  appearance?: 'always' | 'execute' | 'interaction-only'
  language?: string
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: (codigo?: string) => boolean | void
  'timeout-callback'?: () => void
  'refresh-expired'?: 'auto' | 'manual' | 'never'
}

export interface ApiTurnstile {
  render: (alvo: HTMLElement, opcoes: OpcoesTurnstile) => string | undefined
  reset: (id?: string) => void
  remove: (id?: string) => void
  getResponse: (id?: string) => string | undefined
}

declare global {
  interface Window {
    turnstile?: ApiTurnstile
  }
}

export const URL_TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let carregamento: Promise<ApiTurnstile> | null = null

/** Carrega o script uma única vez, como arquivo externo (a CSP não permite script inline). */
export function carregarTurnstile(): Promise<ApiTurnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  carregamento ??= new Promise<ApiTurnstile>((resolver, rejeitar) => {
    const script = document.createElement('script')
    script.src = URL_TURNSTILE
    script.async = true
    script.onload = () => (window.turnstile ? resolver(window.turnstile) : rejeitar(new Error('turnstile ausente')))
    script.onerror = () => {
      carregamento = null
      script.remove()
      rejeitar(new Error('falha ao carregar o turnstile'))
    }
    document.head.appendChild(script)
  })
  return carregamento
}

export interface ControleTurnstile {
  /** Gera um token novo (cada token vale para uma única tentativa). */
  reiniciar: () => void
}

export function Turnstile({
  acao,
  aoMudarToken,
  ref,
}: {
  acao: string
  /** Token válido, ou `null` quando expira/falha/reinicia. */
  aoMudarToken: (token: string | null) => void
  ref?: Ref<ControleTurnstile>
}) {
  const alvo = useRef<HTMLDivElement>(null)
  const widget = useRef<string | undefined>(undefined)
  const retorno = useRef(aoMudarToken)
  const [falha, setFalha] = useState(false)
  const chave = import.meta.env.VITE_TURNSTILE_SITE_KEY

  useEffect(() => {
    retorno.current = aoMudarToken
  })

  useImperativeHandle(ref, () => ({
    reiniciar: () => {
      retorno.current(null)
      if (widget.current !== undefined) window.turnstile?.reset(widget.current)
    },
  }))

  useEffect(() => {
    if (!chave) return
    let ativo = true
    carregarTurnstile().then(
      (api) => {
        if (!ativo || !alvo.current) return
        widget.current = api.render(alvo.current, {
          sitekey: chave,
          action: acao,
          theme: 'auto',
          size: 'flexible',
          appearance: 'interaction-only',
          language: 'pt-br',
          'refresh-expired': 'auto',
          callback: (token) => {
            setFalha(false)
            retorno.current(token)
          },
          'expired-callback': () => retorno.current(null),
          'timeout-callback': () => retorno.current(null),
          'error-callback': () => {
            setFalha(true)
            retorno.current(null)
            return true
          },
        })
      },
      () => {
        if (ativo) setFalha(true)
      },
    )
    return () => {
      ativo = false
      if (widget.current !== undefined) window.turnstile?.remove(widget.current)
      widget.current = undefined
    }
  }, [acao, chave])

  return (
    <div>
      <div ref={alvo} data-testid="turnstile" />
      {(falha || !chave) && (
        <p role="alert" className="ivo-legenda text-[var(--status-cancelada)]">
          Não foi possível fazer a verificação de segurança. Verifique a conexão e recarregue a página.
        </p>
      )}
    </div>
  )
}
