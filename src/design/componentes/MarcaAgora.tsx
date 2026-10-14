/** Triângulo laranja do logo: marcador de "agora" (agenda, linha do tempo) e destino da rota. */
export function MarcaAgora({ tamanho = 14, className = '' }: { tamanho?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 14 12"
      width={tamanho}
      height={(tamanho * 12) / 14}
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <path d="M0 0H14L7 12Z" fill="var(--cor-laranja)" />
    </svg>
  )
}
