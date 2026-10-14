/**
 * Símbolo IVO (docs/marca/svg/ivo-simbolo-*.svg) em linha: as formas usam a cor do texto (marinho no claro,
 * off-white no escuro) e o triângulo fica sempre laranja.
 */
export function SimboloIvo({ altura = 34, rotulo }: { altura?: number; rotulo?: string }) {
  return (
    <svg
      viewBox="0 0 172 148"
      height={altura}
      width={(altura * 172) / 148}
      role={rotulo ? 'img' : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
      className="shrink-0"
    >
      <g fill="currentColor">
        <path d="M3 35C22 34 37 45 49 64c14 21 21 43 40 53 8 4 18 6 25 9-8 12-18 18-30 18-20 0-31-11-41-30z" />
        <path d="M30 36c15 1 28 17 41 35 19 25 34 22 48 22h15l-15 23c-18 0-34-10-49-29C52 64 44 44 30 36z" />
        <path d="M96 73c14-20 31-37 54-40 6-1 13 1 19 2l-30 49c-15 2-29-4-43-11z" />
      </g>
      <path fill="var(--cor-laranja)" d="M45 10h79L84.5 48z" />
    </svg>
  )
}
