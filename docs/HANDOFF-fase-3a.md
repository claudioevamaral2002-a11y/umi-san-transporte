# Handoff: fase 3A (endereços reais, distância e prévia) e o que vem depois

Estado em **18/10/2026**. Este documento passa o projeto de um chat (ou pessoa) para o próximo. Leia antes o [`HANDOFF.md`](../HANDOFF.md), com as regras de ouro e a forma de trabalhar.

## 1. Onde estamos

| Item | Estado |
|---|---|
| **Fase 3A** | **Em produção.** PR #26 (implementação, 12 tarefas) publicado em 14/10 às 21h15; PR #28 (ajuste aos termos do Google) publicado em 15/10 às 01h27, horário de Brasília. CI e Deploy verdes. |
| **Correções do redesign** (fim do "pisca" e cache entre contas) | Em produção, junto com o PR #26. Não tinham entrado no PR #25 porque nunca tinham sido enviadas ao GitHub. |
| **Chaves do Google** | Cadastradas pelo dono no ambiente `producao`: `GOOGLE_MAPS_CHAVE_SERVIDOR` (segredo) e `VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR` (cadastrada como **segredo**; o deploy aceita variável ou segredo). O deploy de 15/10 mandou a chave de servidor ao Supabase, e o app publicado já tem a chave do mapa. |
| **Teste do dono no celular** | Busca, km, mapa e prévia funcionaram. No envio, o pedido foi recusado: o celular ainda rodava a versão anterior (em cache), que mandava campos que o banco novo recusa (ver §4.1). Depois de fechar e abrir o app, ele abriu às 01h36 na versão nova. **Falta o dono confirmar que o envio passou** e terminar o roteiro [`fases/fase-3a-o-que-testar.md`](fases/fase-3a-o-que-testar.md). |
| **Branches** | Nada pendente sem commit. A `fase-3a` e a `fase-3a-termos` já estão na `main`. |
| **PRs do Dependabot abertos** | #2, #4, #23, #27, #29 e #30 (versões de ações e dependências). Não revisados. |

## 2. O que a 3A entregou

- **"Onde?":** locais da empresa primeiro, depois as sugestões do Google (Places API New, pela Edge Function `enderecos`, com a chave só no servidor) e, no fim, "Não achou? Marcar no mapa". Com os dois pontos escolhidos, mostra "NN km pela rota, cerca de NN min".
- **"Marcar no mapa":** Leaflet carregado sob demanda, com os blocos da Map Tiles API. A CSP só ganhou `tile.googleapis.com` em img-src e connect-src.
- **"Confira o pedido" (N1 e N2):** prévia do orçamento pela tabela do contrato (`api.previa_orcamento`, a mesma conta do motorista, que nunca grava orçamento). Com reboque "Não sei", mostra os dois valores. Só no veículo próprio.
- **"Orçar" (motorista):** calcula a rota ao abrir e preenche os km; em ida e volta, o dobro (`trechos_km` vem do banco).
- **Configurações (ADM):** teto diário de buscas por empresa (padrão 2.000). Cada pessoa tem também 500 por dia e 60 sugestões por minuto.
- **Termos do Google (decisão do dono, 15/10):** de um ponto do Google, o pedido e os locais da empresa guardam **só o `place_id`**. Coordenadas só de ponto marcado no mapa. Endereço formatado e km da rota não são guardados. Fonte: Service Specific Terms, itens 14.3 e 19.3.
- **Banco:** migrations `20261015120000` a `20261015120300` e `20261015140000_termos_google.sql`, com os testes pgTAP 0021 a 0024.

## 3. Decisões do dono

- **Fornecedor:** Google Maps Platform.
- **Distância:** é só estimativa. O motorista confirma ou ajusta os km no orçamento oficial, e a cobrança não muda.
- **Km da prévia:** da origem até o destino. Em trecho único, o retorno de 50% vem da tabela; em ida e volta, usa o dobro do trecho.
- **Local sem endereço:** marcar no mapa.
- **Locais da empresa:** sim, aparecem primeiro.
- **Prévia:** N1 e N2.
- **Termos do Google:** seguir à risca, guardando só o `place_id` (15/10).
- **Rastreio (3B):** fazer junto da fase 3 de execução, no PWA, com o app aberto e a tela acesa (Wake Lock).
  - Quem vê: o solicitante, o N1, o ADM e o gestor de frota.
  - Retenção: o trajeto é apagado ao concluir. Fica só o resumo (km real, saída e chegada).
- **Custo do Google:** o dono entendeu as cotas gratuitas e criou o alerta de orçamento. Ver a §6.1 da especificação.
- **Pendente:** a prévia mostra ao N2 o preço por km e a taxa do reboque (como no mockup aprovado e no orçamento oficial). O dono ainda não disse se prefere mostrar só o total.

## 4. Próximo trabalho

### 4.1 Melhoria aprovada pelo dono: pedido depois de uma atualização do app

**Problema (visto em produção em 15/10):**
- O app não se atualiza no meio de um formulário, para não apagar o que a pessoa preenche (`src/lib/atualizacao.ts`, `ROTAS_RECARREGAVEIS`).
- Quem está no Novo pedido durante um deploy que muda as regras do banco continua com o código antigo e recebe `CAMPOS_INVALIDOS`, com a mensagem genérica "Confira os dados informados e tente de novo".
- A auditoria mostrou o motivo: as chaves antigas `km_estimado`, `origem_endereco`… e coordenadas junto do `place_id`.

**Desenho combinado** (ainda sem código):
1. **Em `src/lib/novoPedido.ts`:**
   - `guardarRascunho(f, armazem, agora)` grava em `sessionStorage`, na chave `ivo:novo-pedido-rascunho`, `{ em, f }`;
   - `lerRascunho(armazem, agora)` devolve o formulário **uma vez só** e o apaga. Descarta se tiver mais de 30 minutos ou estiver estragado;
   - nenhuma das duas quebra se o armazenamento estiver bloqueado (navegação privada).
2. **Em `NovoPedido.tsx`, quando `criar_pedido` devolver `CAMPOS_INVALIDOS`:** como o front já validou tudo, isso indica versão desatualizada. Mostrar "O app foi atualizado. Toque em Recarregar e envie de novo; seus dados ficam guardados." e um botão **Recarregar**, que guarda o rascunho e chama `recarregarLimpo()`.
3. **Ao abrir `/pedidos/novo` com rascunho:** começar no passo 4 (Confira) com os dados. O banco confere tudo de novo, inclusive o horário.

**Testes previstos:**
- **Unidade:** guardar e ler uma vez; expira em 30 min; JSON estragado; armazenamento bloqueado.
- **e2e:** `criar_pedido` responde `CAMPOS_INVALIDOS`; aparece o botão; a recarga volta no Confira com os dados, e o segundo envio passa.

Fluxo: TDD, PR para a `main`, merge pelo dono.

### 4.2 Se o "Abrindo sua conta…" voltar a travar

- **O que aconteceu em 15/10:** depois do deploy, a primeira abertura ficou parada em "Abrindo sua conta…" (`src/lib/guardas.tsx`). Nos registros do Supabase não houve nenhuma chamada do celular nesse intervalo, e a abertura seguinte funcionou.
- **Hipótese (não confirmada):** a troca de service worker na primeira abertura depois da atualização.
- **Se repetir por mais de ~20 s:** investigar com `superpowers:systematic-debugging`. Começar pelos registros (`query_logs`, `source = 'edge_logs'`) e por `src/lib/sessao.tsx`.

### 4.3 Pequenos ajustes adiados da revisão final da 3A (nenhum bloqueia)

1. Um "detalhar" atrasado pode sobrescrever o que a pessoa digitou depois (`CampoEndereco.tsx`).
2. Cada foco num campo com texto livre de 3 letras ou mais gasta uma chamada paga ao Google.
3. Texto acima de 120 caracteres mostra o aviso "Não foi possível buscar…", que engana (a função recusa acima de 120).
4. Uma rota que falhou uma vez não é tentada de novo para o mesmo par de pontos.
5. No desktop, soltar o arrasto do mapa sobre o fundo escurecido pode fechar a folha.
6. A longitude do "Marcar no mapa" não usa `wrap()`.
7. Uma rota de menos de 50 m vira km 0 (deveria ser "sem rota").
8. Acessibilidade do combobox: `aria-controls` aponta para um id que não existe com a lista fechada; "Buscando o endereço…" sem região viva; faltam Home e End.
9. Map Tiles: o texto de copyright por região não foi implementado (só "Google").
10. Um `SIGNED_IN` ao voltar o foco pode limpar a memória das consultas (não verificado).
11. A lista de pedidos mostra `total_cent` vindo da memória por um instante.
12. No `deploy.yml`, falta um `trap` para apagar o arquivo temporário da chave se o `secrets set` falhar.

### 4.4 Fase 3B (rastreio), ainda sem especificação

Antes de implementar: especificação e mockups aprovados pelo dono (`superpowers:brainstorming`). Recomendações do estudo público da Uber, adaptadas ao nosso tamanho; confirmar ao especificar:
- **Amostragem:** `watchPosition` com alta precisão, mas **envio** no máximo a cada ~5 s, ou antes se o motorista andar mais de 50 m. Parado por mais de 60 s: só um heartbeat a cada ~30 s. Descartar leituras com `accuracy` acima de ~100 m.
- **Envio:** canal privado do Supabase Realtime por viagem, autorizado para o solicitante, o N1, o ADM e o gestor de frota.
  - Payload `{lat,lng,heading,speed,accuracy,ts,seq}`. O cliente ignora `seq` antigo ("a última vence").
  - No banco, gravar a cada ~30 s ou ~200 m.
- **No mapa:**
  - o carro anda interpolando entre os pontos;
  - acima de 20 s sem dado: "atualizado há X s";
  - acima de 60 s: ícone cinza com "sinal do motorista perdido", sem inventar posição.
- **ETA:** a rota do Google calculada uma vez na saída. Durante a viagem, estimar pela fração percorrida. Recalcular só com desvio maior que ~300 m ou a cada 5 a 10 min, com limite por viagem no banco.
- **Pontos do Google:** os pontos do pedido estão só como `place_id`. A rota e a ETA vão pelo `place_id` (a função `enderecos` já aceita). Se precisar das coordenadas do destino para o mapa, buscar na hora pelo "detalhar": os termos permitem guardar coordenadas por até 30 dias.
- **Mapa:** o mesmo Leaflet com os blocos do Google da 3A, sem afrouxar a CSP. As posições do GPS são do motorista, não do Google.
- **Retenção (decisão do dono):** apagar as posições ao concluir e guardar só o resumo.
- **Depende da execução:** "deslize para sair", status em andamento, conclusão e débito, já previstos na especificação mestre (§12.2 e backlog da fase 3). O carrinho `DesenhoPickup` já está pronto para o "deslize para sair".
- **Fora do escopo agora:** app nativo e rastreio em segundo plano no iPhone (limite do PWA, explicado ao dono). O app do motorista precisa ficar aberto, com a tela acesa.

## 5. Cuidados que já custaram tempo

- **Migration que já está na `main` nunca é editada.**
  - Em 15/10 o PR #26 foi mesclado enquanto o ajuste dos termos ainda era feito em cima dele. O ajuste teve de virar uma migration nova (PR #28).
  - Antes de empilhar commits num PR, confira se ele já foi mesclado: `gh pr view <n> --json state`.
- **O deploy publica o banco antes do front.** Uma mudança que passa a recusar campos quebra quem está com o app antigo aberto. Prefira mudanças compatíveis, ou faça a melhoria da §4.1.
- **Diagnóstico em produção:**
  - pelo MCP do Supabase, no projeto `eoczqrpvhfeulfhjblaw`, **só leitura**;
  - `app.auditoria` (colunas `em`, `acao`, `codigo`, `detalhe`) mostra exatamente qual campo foi recusado;
  - `query_logs` mostra as chamadas do celular.
- **Terminal do dono:** é o Windows PowerShell 5.1. Não use `&&`; passe um comando por bloco.
- **Porta 8788:** pode haver um `workerd` órfão de outra sessão servindo um build velho. Confira com `Get-NetTCPConnection -LocalPort 8788` antes de confiar num e2e local.
- **Scripts:** heredocs com aspas misturadas falham no Bash. Escreva o script num arquivo; o scratchpad fica no **drive D**.
- **Postgres:** a repetição de regex vai no máximo até 255 (`{1,300}` é inválido). Use `+` com `char_length(...) <= 300`.
- **Lista de sugestões:** fecha no `blur` com 200 ms de atraso, de propósito. Fechar na hora encolhia a tela entre o toque e o clique, e o toque caía no "Levar".
- **Testes e2e:** o aviso de texto livre só aparece no campo que chegou a buscar. Ao sair da Origem logo depois de digitar, a busca pendente dela é cancelada.
- **Outros que continuam valendo:**
  - `npx prettier` reformata com ponto e vírgula; não rode;
  - edite arquivos com Python usando `newline=''`;
  - `useConsulta` nunca usa `cache` em leituras de dinheiro;
  - toda chave nova do `criar_pedido` entra também em `interno.validar_pedido`.

## 6. Como falar com o dono

- Português do Brasil, com passo a passo detalhado para ações em painéis (Google Cloud, GitHub, Supabase).
- Mostrar mockups antes de implementar telas novas.
- O merge é sempre dele, porque dispara o deploy.
- Ele prefere publicar fluxos completos de uma vez.
- Chaves e senhas nunca pelo chat.
