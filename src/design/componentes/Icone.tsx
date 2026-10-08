// Ícones de linha (24x24, traço 2) em SVG inline: sem fonte de ícones nem requisição extra.
const CAMINHOS = {
  email: 'M4 6h16v12H4z M4 7l8 6 8-6',
  cadeado: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  olho: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  olhoFechado:
    'M3 3l18 18 M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.1 3.8 M6.6 7.6A17 17 0 0 0 2.5 12S6 18 12 18c1.5 0 2.9-.4 4.1-1 M9.9 10.2a2.5 2.5 0 0 0 3.6 3.5',
  setaEsquerda: 'M19 12H5 M11 6l-6 6 6 6',
  setaDireita: 'M5 12h14 M13 6l6 6-6 6',
  copiar: 'M9 9h11v11H9z M5 15H4V4h11v1',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  casa: 'M4 11l8-7 8 7 M6 9.5V20h12V9.5 M10 20v-5h4v5',
  tabela: 'M4 5h16v14H4z M4 10h16 M4 15h16 M10 10v9',
  usuarios: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.5a3.5 3.5 0 0 1 0 6.5 M18 14.5a6.5 6.5 0 0 1 3.5 5.5',
  predio: 'M5 21V4h10v17 M15 9h4v12 M3 21h18 M8.5 8h3 M8.5 12h3 M8.5 16h3',
  chave: 'M14.5 9.5a4.5 4.5 0 1 1-1.3-3.2 M13.2 12.8L21 20.5 M17.5 17l2-2 M15 14.5l1.5-1.5',
  lista: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
  sair: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10',
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  escudo: 'M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6z M9 12l2 2 4-4',
  fechar: 'M6 6l12 12 M18 6L6 18',
} as const

export type NomeIcone = keyof typeof CAMINHOS

export function Icone({ nome, tamanho = 22, className = '' }: { nome: NomeIcone; tamanho?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={tamanho}
      height={tamanho}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <path d={CAMINHOS[nome]} />
    </svg>
  )
}
