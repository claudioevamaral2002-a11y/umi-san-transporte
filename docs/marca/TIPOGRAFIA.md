# IVO Transportes — Guia tipográfico v1.1

## Conceito
A tipografia segue o mesmo desenho da identidade: simples, geométrica, aberta e com movimento. A hierarquia de informação deve ser mais expressiva que a decoração.

## Identidade × tipografia de apoio

1. **IVO — lettering de marca.** É um desenho autoral de letras vetorizadas com a curva do V e ondas no O; não existe uma fonte instalável que o reproduza fielmente. Para aplicações, sempre usar os SVGs da pasta `/svg`.
2. **TRANSPORTES — assinatura da marca.** No kit vetorial atual, foi reconstruído como contornos com base na Inter Medium, espaçada. Não é texto vivo nem depende da instalação de Inter. Não substituir a assinatura dentro do logotipo por texto corrido.
3. **Comunicação, interface e documentos — Manrope.** Família de uso geral no PWA, relatórios, cartões, etiquetas, material comercial e documentação.

## Fonte recomendada

**Manrope** — página oficial: https://fonts.google.com/specimen/Manrope

- Light 300: títulos editoriais especiais (uso restrito)
- Regular 400: corpo de texto, descrições, documentos
- Medium 500: subtítulos, rótulos e navegação
- Semibold 600: botões, campos e destaques
- Bold 700: títulos, cards prioritários e valores
- ExtraBold 800: chamadas de alto impacto, com moderação

**Fallback:** Inter, Arial, sans-serif.

### Escala para o aplicativo (mobile-first)

| Elemento | Peso | Tamanho | Altura da linha | Espaçamento |
|---|---:|---:|---:|---:|
| Display / campanha | 800 | 40 px | 1.08 | -0.045em |
| Título principal (H1) | 700 | 30 px | 1.18 | -0.035em |
| Título de seção (H2) | 700 | 24 px | 1.25 | -0.025em |
| Título de card (H3) | 700 | 18 px | 1.35 | -0.015em |
| Corpo | 400 | 16 px | 1.55 | 0 |
| Corpo em destaque | 600 | 16 px | 1.5 | 0 |
| Campos e botões | 600 | 16 px | 1.3 | 0 |
| Legenda/ajuda | 500 | 13 px | 1.4 | 0 |
| Sobretítulo | 700 | 11 px | 1.3 | 0.16em |
| Valores principais | 700 | 30 px | 1.15 | -0.025em |
| Valores em tabelas | 600 | 14–16 px | 1.4 | 0 |

Para uso no sol, preferir corpo de 16 px ou mais, contraste reforçado e não usar Light nos controles.

### Números e valores

- Usar `font-variant-numeric: tabular-nums` em **todos** os valores monetários, saldos, datas, duração e números em tabelas.
- Exibir sempre como `R$ 1.234,56`, com formatação `pt-BR`.
- Estilizar débito e crédito por texto/sinal e não apenas por cor.
- Não animar resultado financeiro antes de a resposta do servidor confirmar a operação.

### Uso nas peças da marca

- **Peças comerciais:** chamadas curtas em Manrope 700/800, frases de apoio em Manrope 400, etiquetas em Manrope 700 caixa alta com entreletras de 0.16em.
- **Veículos, uniforme, papelaria:** usar o SVG do logotipo para a assinatura; Manrope para telefone, site, cargos e descrição dos serviços.
- **App PWA:** títulos 700, textos 400, botões 600/700, números financeiros 700 + tabular-nums; manter o logo como SVG, não reescrever `IVO` com Manrope.

## Integração Next.js App Router

Arquivo ilustrativo: `next-font-exemplo.tsx` (adapte ao `app/layout.tsx`). Estilos: `tipografia.css`.

## Compatibilidade visual

Este documento descreve regras propostas para construir o produto. O logo é uma reconstrução interpretativa em vetor da referência escolhida; fonte de interface e desenho original do logotipo têm funções diferentes. Revisar prova de impressão antes de plotagem/adesivação de grande formato.

**Nota sobre fontes:** arquivos de fontes não integram este pacote. Consulte o fornecedor da família tipográfica e respectivas condições de licença para distribuir/empacotar arquivos em seu projeto.
