import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react'

const TOTAL = 6
export const CODIGO_VAZIO = ' '.repeat(TOTAL)

/** `valor` guarda as 6 posições (espaço = vazia). */
export function codigoCompleto(valor: string): string | null {
  return /^\d{6}$/.test(valor) ? valor : null
}

/**
 * Seis caixas para o código do autenticador. Colar (ou o preenchimento automático do sistema,
 * `autocomplete="one-time-code"`) com os 6 dígitos preenche todas; Backspace volta uma caixa.
 */
export function CodigoSeisDigitos({
  valor,
  aoMudar,
  aoCompletar,
  desabilitado = false,
  idRotulo,
  invalido = false,
}: {
  valor: string
  aoMudar: (valor: string) => void
  aoCompletar?: (codigo: string) => void
  desabilitado?: boolean
  /** id do elemento que rotula o grupo. */
  idRotulo: string
  invalido?: boolean
}) {
  const caixas = useRef<Array<HTMLInputElement | null>>([])
  const posicoes = Array.from({ length: TOTAL }, (_, i) => (valor[i] ?? ' ').trim())

  function focar(i: number) {
    const alvo = caixas.current[Math.max(0, Math.min(TOTAL - 1, i))]
    alvo?.focus()
    alvo?.select()
  }

  function gravar(novas: string[], proximo: number | null) {
    const novo = novas.map((d) => d || ' ').join('')
    aoMudar(novo)
    const completo = codigoCompleto(novo)
    if (completo && aoCompletar) {
      caixas.current.forEach((c) => c?.blur())
      aoCompletar(completo)
    } else if (proximo !== null) {
      focar(proximo)
    }
  }

  /** Distribui dígitos a partir de `inicio`; 6 ou mais dígitos substituem o código inteiro. */
  function distribuir(inicio: number, digitos: string) {
    if (digitos.length >= TOTAL) {
      gravar(digitos.slice(0, TOTAL).split(''), TOTAL - 1)
      return
    }
    const novas = posicoes.slice()
    let i = inicio
    for (const d of digitos) {
      if (i >= TOTAL) break
      novas[i++] = d
    }
    gravar(novas, Math.min(i, TOTAL - 1))
  }

  function mudar(i: number, bruto: string) {
    let digitos = bruto.replace(/\D/g, '')
    if (!digitos) {
      const novas = posicoes.slice()
      novas[i] = ''
      gravar(novas, null)
      return
    }
    // Digitou numa caixa já preenchida sem seleção: fica só o dígito novo.
    const antigo = posicoes[i]
    if (antigo && digitos.length === 2 && digitos.includes(antigo)) digitos = digitos.replace(antigo, '')
    distribuir(i, digitos)
  }

  function teclar(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const novas = posicoes.slice()
      if (novas[i]) {
        novas[i] = ''
        gravar(novas, i)
      } else if (i > 0) {
        novas[i - 1] = ''
        gravar(novas, i - 1)
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focar(i - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      focar(i + 1)
    }
  }

  function colar(i: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    distribuir(i, e.clipboardData.getData('text').replace(/\D/g, ''))
  }

  return (
    <div role="group" aria-labelledby={idRotulo} className="flex justify-between gap-2">
      {posicoes.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            caixas.current[i] = el
          }}
          value={d}
          disabled={desabilitado}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Dígito ${i + 1} de ${TOTAL}`}
          aria-invalid={invalido || undefined}
          onFocus={(e) => e.target.select()}
          onChange={(e) => mudar(i, e.target.value)}
          onKeyDown={(e) => teclar(i, e)}
          onPaste={(e) => colar(i, e)}
          className={`h-14 w-full min-w-0 max-w-14 rounded-campo border-2 bg-superficie text-center text-2xl font-bold tabular-nums text-texto caret-[var(--cor-acao)] outline-none transition-[border-color,box-shadow] duration-150 focus:border-acao focus:shadow-[0_0_0_3px_rgb(255_106_0/0.3)] disabled:opacity-60 motion-reduce:transition-none ${
            invalido ? 'border-[var(--status-cancelada)]' : d ? 'border-texto' : 'border-borda'
          }`}
        />
      ))}
    </div>
  )
}
