import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Botao } from './Botao.tsx'
import { Icone } from './Icone.tsx'

const LIMIAR = 0.9
const reduzido = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Pickup pequena do pino do trilho (o desenho grande, DesenhoPickup, é o da animação de saída). */
function PickupPequena() {
  return (
    <svg viewBox="0 0 64 36" width="34" height="20" aria-hidden="true">
      <path fill="currentColor" d="M6 22h4l5-11h17v11h4V9h12l8 9 4 2v6h-4a6 6 0 0 0-12 0H26a6 6 0 0 0-12 0H6z" />
      <circle cx="20" cy="27" r="4.5" fill="currentColor" />
      <circle cx="42" cy="27" r="4.5" fill="currentColor" />
    </svg>
  )
}

/**
 * "Deslize para sair" (especificação 12.2): o carrinho percorre o trilho e, ao soltar no fim, confirma. Teclado: seta
 * para a direita avança, Enter ou End confirma. Com movimento reduzido vira um botão que pede um segundo toque.
 * A confirmação chama o servidor; durante `ocupado` o trilho fica no fim e travado (nenhuma UI otimista).
 */
export function TrilhoSair({
  rotulo = 'Deslize para sair',
  desabilitado = false,
  ocupado = false,
  aoConfirmar,
}: {
  rotulo?: string
  desabilitado?: boolean
  ocupado?: boolean
  aoConfirmar: () => void
}) {
  const trilho = useRef<HTMLDivElement>(null)
  const arrasto = useRef<{ inicioX: number; largura: number } | null>(null)
  const [fracao, setFracao] = useState(0)
  const [confirmando, setConfirmando] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const travado = desabilitado || ocupado

  // Terminou o envio (ou falhou): o carrinho volta ao começo (ajuste durante a renderização, sem efeito).
  const [ocupadoAntes, setOcupadoAntes] = useState(ocupado)
  if (ocupado !== ocupadoAntes) {
    setOcupadoAntes(ocupado)
    if (!ocupado) setFracao(0)
  }

  useEffect(() => {
    if (!confirmando) return
    const t = setTimeout(() => setConfirmando(false), 4000)
    return () => clearTimeout(t)
  }, [confirmando])

  if (reduzido()) {
    return (
      <Botao
        variante="principal"
        className="w-full"
        disabled={travado}
        data-testid="trilho-sair"
        onClick={() => {
          if (!confirmando) {
            setConfirmando(true)
            return
          }
          setConfirmando(false)
          aoConfirmar()
        }}
      >
        {ocupado ? 'Registrando a saída…' : confirmando ? 'Toque de novo para confirmar a saída' : 'Confirmar saída'}
      </Botao>
    )
  }

  function confirmar() {
    setFracao(1)
    aoConfirmar()
  }

  function aoBaixar(e: PointerEvent<HTMLButtonElement>) {
    if (travado || !trilho.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const caixa = trilho.current.getBoundingClientRect()
    arrasto.current = { inicioX: e.clientX - fracao * (caixa.width - 64), largura: caixa.width - 64 }
    setArrastando(true)
  }

  function aoMover(e: PointerEvent<HTMLButtonElement>) {
    const a = arrasto.current
    if (!a || a.largura <= 0) return
    setFracao(Math.min(1, Math.max(0, (e.clientX - a.inicioX) / a.largura)))
  }

  function aoSoltar() {
    if (!arrasto.current) return
    arrasto.current = null
    setArrastando(false)
    if (fracao >= LIMIAR) confirmar()
    else setFracao(0)
  }

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    if (travado) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      const nova = Math.min(1, fracao + 0.25)
      if (nova >= 1) confirmar()
      else setFracao(nova)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'Home') {
      e.preventDefault()
      setFracao(0)
    } else if (e.key === 'Enter' || e.key === 'End') {
      e.preventDefault()
      confirmar()
    }
  }

  const posicao = ocupado ? 1 : fracao
  return (
    <div
      ref={trilho}
      role="slider"
      tabIndex={travado ? -1 : 0}
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(posicao * 100)}
      aria-valuetext={ocupado ? 'Registrando a saída' : rotulo}
      aria-disabled={travado}
      onKeyDown={aoTeclar}
      data-testid="trilho-sair"
      className={`sobre-marinho relative flex h-16 touch-none items-center overflow-hidden rounded-full bg-comando text-comando-texto outline-offset-4 select-none ${
        travado && !ocupado ? 'opacity-50' : ''
      }`}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 rounded-full bg-[var(--cor-laranja)]/25"
        style={{ width: `calc(${posicao} * (100% - 64px) + 64px)` }}
      />
      <span className="relative mr-6 ml-auto flex items-center gap-1.5 text-[15px] font-bold" style={{ opacity: 1 - posicao }}>
        {rotulo}
        <Icone nome="setaDireita" tamanho={18} />
      </span>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        disabled={travado}
        onPointerDown={aoBaixar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={() => {
          arrasto.current = null
          setArrastando(false)
          setFracao(0)
        }}
        className={`absolute top-1.5 flex size-[52px] cursor-grab items-center justify-center rounded-full bg-[var(--cor-laranja)] text-[var(--cor-marinho)] active:cursor-grabbing ${
          arrastando ? '' : 'transition-[left] duration-200'
        }`}
        style={{ left: `calc(${posicao} * (100% - 64px) + 6px)` }}
        data-testid="trilho-sair-pino"
      >
        <PickupPequena />
      </button>
    </div>
  )
}
