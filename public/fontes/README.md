# Fontes locais da v2

- Manrope Variable 5.3.0: arquivos Latin e Latin Extended de `@fontsource-variable/manrope`, já instalado no projeto.
- DM Sans Variable 5.3.0: arquivos Latin e Latin Extended de `@fontsource-variable/dm-sans`, copiados do pacote publicado. Não foi adicionada uma dependência ao aplicativo.
- Cada família acompanha sua licença SIL Open Font License 1.1 (`*-OFL.txt`).

Os quatro WOFF2 foram comparados byte a byte com os arquivos dos pacotes 5.3.0. A folha `src/novo/fontes.css` referencia somente `/fontes/` na própria origem. A entrada da v1 continua com seu import anterior de Manrope; não importa os estilos ou tokens da v2.
