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
  mais: 'M12 5v14 M5 12h14',
  lixeira: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  busca: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M15.5 15.5L20 20',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  conversa: 'M4 19.5l1.4-4A8 8 0 1 1 8.6 18.6z M9 10.5h6 M9 13.5h4',
  imagem: 'M4 5h16v14H4z M4 16l5-5 4 4 2.5-2.5L20 17 M15.5 9.5h.01',
  relogio: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  alerta: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  lapis: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  setaBaixo: 'M6 9l6 6 6-6',
  calendario: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  menos: 'M5 12h14',
  caminhao: 'M2 6h11v10H2z M13 9h4.5l3.5 3.5V16h-8 M6 19a1.75 1.75 0 1 0 0-3.5A1.75 1.75 0 0 0 6 19z M17 19a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z',
  local: 'M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  setaDireitaPequena: 'M9 6l6 6-6 6',
  dinheiro: 'M3 7h18v12H3z M3 7l3-3h12l3 3 M12 15.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M6.5 13h.01 M17.5 13h.01',
  grafico: 'M4 20h16 M7 16v-5 M12 16V7 M17 16v-8',
  play: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M10 8.5v7l5.5-3.5z',
  checkCirculo: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8 12.5l2.7 2.7L16 9.8',
  ampulheta: 'M7 3.5h10 M7 20.5h10 M8 3.5c0 5 8 5 8 8.5s-8 3.5-8 8.5 M16 3.5c0 5-8 5-8 8.5',
  setaCima: 'M12 19V6 M6.5 11.5L12 6l5.5 5.5',
  setaParaBaixo: 'M12 5v13 M6.5 12.5L12 18l5.5-5.5',
  desfazer: 'M9 7L4.5 11.5 9 16 M5 11.5h9a5 5 0 0 1 0 10h-2',
  // Fase 3B
  telefone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  mapa: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z M9 4v14 M15 6v14',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  sinal: 'M12 20h.01 M8.5 16.5a5 5 0 0 1 7 0 M5 13a10 10 0 0 1 14 0',
  // Fase 4: link que abre o app atual (outra origem).
  externo: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6',
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
