# Requisitos para a reforma visual não quebrar os serviços

Estes são os requisitos para quem for mexer no front do IVO Transportes. Valem junto com [`MATRIZ_PRESERVACAO.md`](MATRIZ_PRESERVACAO.md), que lista item a item o que o app faz, e com [`v2-3-desenho.md`](v2-3-desenho.md). Base: v2.2.1 (`e7ec62a`).

## 1. Escopo
1. Só muda o **front do app novo** (`src/novo` e as telas de `src/telas` que ele reaproveita). As telas da v1 também aparecem no app antigo, então a mudança nelas tem de servir aos dois.
2. **Fica sem mudança:**
   - o banco (`supabase/migrations`, sem editar migration antiga);
   - as Edge Functions (`supabase/functions`);
   - a autenticação;
   - o deploy (`.github/workflows`);
   - o app v1 (`src/rotas.tsx`, publicado em ivo-v1.pages.dev).
3. Se faltar dado do banco para uma tela, **pare e descreva o contrato que falta**. Não invente valor no front.

## 2. Pilha (não trocar)
4. Usar a pilha de hoje, **sem migrar nem trocar biblioteca:**
   - Vite + React 19 + TypeScript + Tailwind;
   - React Router (`src/novo/rotas.tsx`);
   - PWA com service worker e o aviso "Nova versão · Atualizar".
5. Toda chamada ao servidor passa pelos módulos de `src/lib/*`, nunca por `supabase.rpc` solto numa tela. Os nomes e os parâmetros das RPCs `api.*` não mudam.
6. Os tipos de resposta estão em `src/lib/*.ts`, por exemplo `RespostaPedido`, `CategoriaComPreco` e `ItemPedido`. Leia por eles e não reinterprete os campos.

## 3. Regras de negócio (nada disso pode ir para o front)
7. **O preço vem só do banco:**
   - a prévia (`categorias_disponiveis` → `linhas`, `total_cent`);
   - o orçamento e o memorial;
   - a calculadora do motorista.
   A tela só **mostra**. É proibido calcular, arredondar de outro jeito ou usar números do protótipo como reserva.
8. **Dinheiro em centavos:**
   - formatado por `formatarCentavos` (`src/design/dinheiro.ts`);
   - nada de interface otimista em dinheiro (reserva, débito, recarga, fatura): a tela espera a resposta do banco;
   - os botões de ação ficam desabilitados enquanto a chamada está em andamento, para não duplicar.
9. **Permissões são do banco.** O front esconde botões por perfil (CLIENTE N1/N2/N3, MOTORISTA, ADM/Master), mas não pode ser a única barreira.
   - Não juntar perfis: Master ≠ Administrador da empresa (N1).
   - O Solicitante (N2) vê só os próprios pedidos.
   - O Visualizador (N3) vê a empresa e não pede nem aprova.
10. **Recusas do banco:** respostas `{ok:false, codigo}` são mostradas com `mensagemDoPedido` / `mensagemDoCodigo` (`src/lib/erros.ts`). Todo código novo precisa de mensagem; um teste confere isso.
11. Estes itens continuam visíveis e funcionando:
    - **capacidade** (`pessoas_max`);
    - **diárias** e **outros custos**;
    - **paradas** (até 3);
    - **volta à origem**;
    - **horas** (IVO Motorista);
    - **centro de custo**;
    - **Faturado (NF)** versus **Crédito**;
    - **faixas de cancelamento** e multa;
    - "**Ver cálculo**";
    - **número do pedido** e **Detalhes do pedido**;
    - **"Sem cobrança" / "Multa R$ X"**;
    - **"Últimos lugares"** no De/Para.
12. Na calculadora do motorista (ProporValor), **todas** as variáveis continuam editáveis: km, fixo, retorno, espera, reboque, hospedagem/diárias, horas, paradas e outros. Pode recolher as que estão em zero, mas não pode tirar nenhuma.
13. **Decisões recentes do dono que não podem voltar:**
    - não há "Carteira da empresa" no menu nem na barra de baixo;
    - não há tela "Locais salvos";
    - não há "Ida e volta";
    - o saldo e o extrato ficam no **Painel da empresa › Carteira** (só N1 e Master).

## 4. Mapa, localização e tempo real
14. O mapa é o **Google Maps** de hoje, com a chave `VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR`. Nada de mapa ilustrativo em produção.
15. A busca de endereço (`CampoEndereco`, função `enderecos`) mantém:
    - a sessão de busca;
    - o "Marcar no mapa";
    - a regra de **não sobrescrever** um campo com resposta atrasada;
    - o atributo "Google Maps" nas sugestões.
16. **O rastreio ao vivo existe.** O motorista envia a posição em `/viagem/:id` (`useEnvioDePosicao`), e o cliente vê em `/corrida/:id` (`useAcompanhamento`, canal privado `rastreio:<id>`).
    - Os estados "atrasado" (20 s) e "perdido" (60 s) continuam.
    - Uma posição antiga nunca pode aparecer como "ao vivo".
    - Quem não pode ver o mapa (N3 e outros N2) vê só o status.
    - Não há posição antes da saída: não simular.
17. O motorista mantém:
    - o aviso LGPD de compartilhar a localização;
    - o Wake Lock;
    - "Deslize para sair";
    - "Concluir serviço";
    - as fotos.

## 5. Segurança e publicação
18. **CSP sem estilos inline:** não usar `style={{...}}` nem `<style>` dentro de componentes. Use classes. Tem teste e2e que confere isso.
19. **Fontes novas** (Manrope, DM Sans) vão como arquivos `woff2` em `public/`, servidos pelo próprio app. **Não** usar Google Fonts por URL externa, porque a CSP bloqueia e os testes falham.
20. Sem segredo, chave ou `.env` no código. As variáveis do front são as `VITE_*` de `src/vite-env.d.ts`.
21. O login mantém o **Turnstile**, o **2FA** (aal2) e o "definir senha". Não mexer no fluxo de autenticação.
22. Os **apps antigos continuam no ar.** A v1 e as versões em cache nos celulares chamam o mesmo banco, então a reforma não pode exigir mudança de banco que quebre o que eles mandam.

## 6. Acessibilidade e layout
23. Larguras de 360, 390, 768 e 1440 px, **sem rolagem lateral**. No celular, o botão principal não pode ficar inalcançável com o teclado aberto.
24. Modo **claro e escuro**:
    - contraste conferido por `src/design/contraste.test.ts`;
    - laranja como texto usa a variante escura (`--cor-alerta-texto`).
25. Rótulos em todos os campos, foco visível, erro ligado ao campo (`aria-invalid` e `aria-describedby`), `aria-live` nos avisos e respeito a "reduzir movimento".
26. Os textos de tela que os testes procuram são **exatos**, por exemplo:
    - "Cancelada sem cobrança";
    - "até 4 pessoas";
    - "Deslize para sair";
    - "Últimos lugares";
    - "Faturado (NF)".
    Mudar um texto obriga a atualizar o teste e avisar o dono.

## 7. Testes e entrega
27. Antes de cada PR, rodar:
    - `npm run typecheck`, `npm run lint` e `npm run test:unit`;
    - os e2e afetados (`npx playwright test …`, projetos `novo` e `celular`).
    O CI do GitHub roda tudo, inclusive os testes contra o banco real (`tests/e2e/real`), e **precisa ficar verde**.
28. Não apagar nem afrouxar teste para passar. Se um teste quebrou porque a tela mudou de propósito, ajuste o teste para conferir a mesma regra na tela nova.
29. **Um PR por módulo** (M0 moldura, M1 pedir, M2 corrida/listas, M3 motorista, M4 Master), cada um com:
    - capturas antes e depois (computador e celular);
    - as linhas da `MATRIZ_PRESERVACAO.md` marcadas com o destino e o resultado do teste;
    - as lacunas e as diferenças visuais anotadas.
30. **O merge é sempre do dono.** Nada de merge automático nem publicação direta. O deploy roda sozinho depois do merge na `main`.
31. Versão no `package.json` (e só os dois campos `version` do `package-lock.json`), começando em **2.3.0**. Ela aparece em Perfil e segurança.
