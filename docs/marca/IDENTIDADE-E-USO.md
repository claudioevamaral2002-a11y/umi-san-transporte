# IVO Transportes — Arquivos da identidade visual

**Conceito aprovado:** letra I sólida; V com fluxo/curva; O com duas ondas; triângulo laranja; símbolo derivado do V. Esta é uma **reconstrução vetorial interpretativa da imagem de referência**, não o arquivo original de criação do designer. Deve ser revisada visualmente antes da produção de grande formato.

## Cores
- Azul-marinho: `#0A2540`
- Off-white: `#F6F4EE`
- Laranja sinal: `#FF6A00`

## Fontes
- **IVO:** lettering vetorial exclusivo em curvas Bézier; não depende de fonte.
- **TRANSPORTES:** lettering convertido em curvas a partir de Inter Medium com entreletras amplo; não depende de fonte instalada.
- **Interface do sistema:** Manrope (recomendada; carregar separadamente com licenciamento apropriado), fallback Inter, Arial, sans-serif.

## Uso
- Fundo claro: `svg/ivo-logotipo-azul.svg`
- Fundo escuro: `svg/ivo-logotipo-branco.svg`
- Espaço horizontal estreito: variantes `ivo-logotipo-horizontal-*`
- Símbolo sem texto: `svg/ivo-simbolo-azul.svg` ou `ivo-simbolo-branco.svg`
- Ícone PWA: `app_icons/ivo-icon-escuro-192.png` e `512.png`
- Ícone PWA maskable: `app_icons/ivo-maskable-512.png`
- iPhone: `app_icons/apple-touch-icon-180.png`

**Importante:** `svg` são formas vetoriais reais e independentes. Não contêm imagens incorporadas, nem links externos, nem precisam carregar tipografia. Os PNGs possuem transparência nas versões de logotipo e símbolo; os ícones PWA têm fundo sólido.

**Área de respiro:** manter no mínimo 12% da altura do logotipo em volta; não distorcer, acrescentar gradientes ou trocar o laranja de posição. O ícone maskable já foi dimensionado com respiro central extra.

## Transparência e limites
A base foi uma prévia de identidade visual gerada por IA, e não um arquivo-fonte de design. A reconstrução preserva os elementos principais, mas não representa uma correspondência pixel a pixel. Não constitui avaliação de disponibilidade de marca comercial / INPI.

## Guia tipográfico complementar
- `docs/TIPOGRAFIA.md`: pesos, hierarquia, espaçamento, números tabulares e uso no aplicativo.
- `docs/tipografia.css`: classes CSS e tokens tipográficos.
- `docs/next-font-exemplo.tsx`: exemplo de carregamento da Manrope no Next.js.
- Página oficial da família: https://fonts.google.com/specimen/Manrope
- **Não há arquivos de fontes dentro do pacote.** O logo já está em caminhos vetoriais, independente da fonte de interface.
