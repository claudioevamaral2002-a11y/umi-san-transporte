# Handoff — IVO Transportes (app da Umi San)

Estado em **20/10/2026**. Este documento é o ponto de partida para quem continuar o projeto, seja pessoa ou agente.

## 1. O que é

PWA (Vite + React) para **agendar, orçar, aprovar e executar transportes** de pessoas e equipamentos, com **cobrança em saldo pré-pago por empresa cliente**. A marca é a **IVO Transportes**, que presta o serviço; a **Umi San** é a primeira empresa cliente.

- Produção: https://umi-san-transporte.pages.dev
- Repositório: este (privado). Deploy automático só a partir da `main`, depois que o CI passa.
- Especificação mestre: [`docs/especificacao.md`](docs/especificacao.md). A v5 continua no corpo do arquivo, e os **Adendos A1–A10** prevalecem sobre ela; o A10 é a v6.

## 2. Arquitetura (decisão "B")

```
PWA estática (Cloudflare Pages)  ──supabase-js (JWT 15 min)──►  Supabase sa-east-1
                                                                 ├─ Postgres: TODA a regra de negócio
                                                                 │   schemas: api (exposto) · app (tabelas) · interno (sistema)
                                                                 ├─ Auth: senha forte + HIBP, 2FA TOTP (ADM/motorista/gestor), Turnstile
                                                                 ├─ Edge Functions: convidar, definir-senha, gerir-usuario, resgatar-link
                                                                 ├─ Realtime Broadcast privado (atividade:, empresa:, equipe, saldo:)
                                                                 ├─ Storage: bucket privado "logos"
                                                                 └─ pg_cron: expirar-vencidos (15 min), reconciliar-saldos (03:00 BRT)
GitHub Actions: CI (pgTAP + integração + e2e real) → Deploy (config push → db push → funções → Pages)
```

**Regras de ouro**, que devem ser seguidas em qualquer mudança:
1. **Toda regra fica no banco.** O front só chama RPCs de `api.*` e lê o que elas devolvem. As tabelas de `app` não têm escrita para usuários.
2. **As RPCs** são `SECURITY DEFINER` com `search_path = ''` e devolvem `{ok, codigo}`. Negações são **auditadas** e não abortam a transação (Adendo A2).
3. **Dinheiro** é sempre em centavos (inteiro). O arredondamento é meio para cima, por linha. **Nenhuma UI otimista em ação financeira.**
4. **Livro-razão imutável.** O saldo só muda via `app.lancamentos`, e a conta é protegida por trigger. Correções são feitas só por **ajuste** ou **estorno**, sempre com motivo.
5. **Migrations: só criar novas.** Nunca editar uma que já está na `main`. A guarda pgTAP `0001_privilegios` tem de continuar verde.

## 3. O que está pronto (em produção)

| Fase | Entregue |
|---|---|
| 0 | Esteira: PWA, CSP rígida, CI com Supabase real, deploy só com CI verde, design system |
| 1 | Convite por **link curto** imune a pré-visualização (`/c/<código>`), senha forte + HIBP, 2FA, perfis, auditoria imutável, rate limit, Auth como código |
| 1B | **Contrato por empresa**, publicado só pelo ADM a partir de uma tabela modelo; papéis **ADM / Gestor de frota / Motorista**; cliente **N1 (gestor da empresa) / N2 (solicitante) / N3 (visualizador)**; visibilidade por perfil |
| 2A | **Novo pedido** em 4 passos com calendário e horários livres; pré-reserva com bloqueio de conflito no banco; **orçamento-calculadora** do motorista (quantidades × preço travado do contrato); revisão, reprovação, recusa, cancelamento; agenda mês/dia; pendências; tempo real |
| 3A (PR aberto) | **Endereços reais** (Google Places New, pela função `enderecos`, chave só no servidor), **locais da empresa** primeiro, **marcar no mapa** (Leaflet + Map Tiles, sem afrouxar a CSP), **km e tempo da rota**, **prévia do orçamento** para N1/N2 e **km preenchidos no Orçar**. Teto diário por empresa em Configurações |
| 2B | **Motor de saldo**: recarga, ajuste e estorno (só ADM), reserva, **aprovação** com limite de crédito, **cancelamento de agendado com multa** pelas faixas do snapshot (valor travado entre prévia e confirmação), extrato (CSV/PDF), **painel do ADM**, reconciliação diária |

Testes: ~1150 asserções pgTAP, ~100 de integração com concorrência real, ~200 de unidade e ~95 e2e (simulados e contra o banco real). Antes de cada publicação, o CI também aplica as migrations sobre uma cópia do estado de produção.

## 4. Pendências imediatas (para o dono)

1. **Rodar o roteiro de produção** [`docs/fases/roteiro-producao-1b-2a-2b.md`](docs/fases/roteiro-producao-1b-2a-2b.md), com 26 passos. No dia seguinte, conferir a reconciliação das 03:00 no Painel do ADM.
2. **Revisar os PRs do Dependabot** #2–#5 (versões das ações do GitHub). Ver a issue correspondente.
3. **Contas do negócio** (bloqueante antes de clientes reais): e-mail dedicado, 2 administradores com 2FA, repositório transferido para uma organização. Ver especificação §11 e a issue.
4. **Domínio próprio** (adiado por decisão do dono): habilita o endereço por cliente (A9) e o e-mail automático (Resend).

## 5. Próximas fases (backlog em issues #11–#20)

- **Fase 4 — IVO novo, estilo Uber (PR aberto, em teste no `ivo-novo.pages.dev`):** ver a seção 5B.
- **Fase 3B — Execução e rastreio (PR em revisão, 18/10):** "deslize para sair" com débito, posição do motorista ao vivo para o cliente, nova previsão e atraso, conclusão com fotos. Especificação, plano e roteiro: `docs/fases/fase-3b-*.md`; operação: RUNBOOK §17.
- **Fase 3 — restante:** retenção das fotos (com o e-mail da fase 5); aditivo; revisão de contrato já aprovado (§4.4); anexos no pedido; "Repetir pedido".
- **Fase 5 — Operação:** notificações (outbox, push e e-mail), backup diário criptografado no R2, *dead man's switch* (Healthchecks), teste de restauração mensal, monitoramento.
- **SMS como 2º fator** (A8), para motoristas com pouca familiaridade com tecnologia.
- **Fase 6 — Fechamento:** `SECURITY.md` com evidências, README completo, migração de contas.

## 5B. Fase 4 (IVO novo): estado e pendências

**Estado:** no PR (branch `fase-4`), **ainda não mesclado**. Depois do merge, o Deploy publica os dois sites. **Teste no `ivo-novo.pages.dev` antes de trocar o endereço principal.**

**O que foi construído:** segundo site no mesmo banco (o app atual não muda), no estilo Uber: mapa na frente; **categorias** (Passageiros, Carga Leve, Carga Pesada) com preço por categoria no contrato; **Agendar e Agora**; trajeto desenhado; **veículos** do motorista; chamada em tela cheia; **contraproposta por calculadora**; centro de custo; saída e viagem com a rota no app; acompanhamento com a última posição; **avaliação** e "Pedir de novo"; menu por perfil (Master, Motorista, Administrador, Solicitante, Visualizador); **Painel da empresa** (resumo do mês, corridas, pessoas, CSV). Desenho: `docs/fases/fase-4-ivo-estilo-uber-desenho.md`; roteiro: `docs/fases/fase-4-o-que-testar.md`; operação: RUNBOOK §18.

**Pendências do dono** (passo a passo no RUNBOOK §18.9):
1. Google Cloud: adicionar `https://ivo-novo.pages.dev/*` à chave `navegador-mapa` e deixá-la **só com a Map Tiles API** (remover Places e Routes; pendente desde 19/10).
2. Cloudflare Turnstile: adicionar o hostname `ivo-novo.pages.dev` ao widget.
3. Master: publicar os preços por categoria (☰ › Categorias e preços, **só pelo app novo**) e preencher **Contato para recarga** em Configurações.
4. Ivo: salvar o telefone em Perfil e cadastrar os veículos.
5. Rodar o roteiro `docs/fases/fase-4-o-que-testar.md`.

O projeto Pages `ivo-novo` e a URL de retorno do Supabase são feitos pelo Deploy.

**Limitações conhecidas (PWA, por decisão do dono):**
- o rastreio só funciona com o app aberto e a tela acesa; com o Waze na frente o cliente vê "sinal perdido";
- a chamada só toca com o app aberto (push é da fase 5); fechado, fica em Pendências;
- não há voz curva a curva (só no app nativo);
- o gestor de frota não tem telas no app novo (usa o app atual);
- **Locais salvos** e **Ajuda** aparecem como "em breve";
- publicar contrato pela tela do app atual derruba os preços por categoria.

**Próximos passos:**
- correção do PWA que deixa o app instalado preso numa versão antiga (o app novo já nasce com o aviso "Nova versão · Atualizar"; falta o app atual);
- notificações (fase 5): chamada ao Ivo e avisos ao cliente com o app fechado;
- app nativo do motorista (rastreio em segundo plano e voz curva a curva): opções e custos na §10 do desenho da fase 4;
- trocar o endereço principal: servir o app novo em `umi-san-transporte.pages.dev` quando o dono aprovar (revisar o endereço fixo do app atual no menu e o `APP_ORIGENS`);
- os itens menores adiados nas revisões ficam triados na revisão final da fase.

## 6. Onde está cada coisa

| Precisa de… | Veja |
|---|---|
| Regras do produto | `docs/especificacao.md` (Adendos no fim) |
| Desenho e decisões de cada fase | `docs/fases/fase-*-desenho*.md` (cada um com desvios e riscos aceitos) |
| Operação: primeiro ADM, links, 2FA, saldo, divergência, horário preso | `docs/RUNBOOK.md` |
| Marca, logos e tipografia | `docs/marca/` |
| Banco | `supabase/migrations/` (em ordem) e `supabase/tests/` (pgTAP) |
| Google Maps (chaves, teto, troca) | `docs/RUNBOOK.md`, item 16 |
| Funções de servidor | `supabase/functions/` |
| Automações | `.github/workflows/`: `ci`, `deploy`, `criar-primeiro-adm`, `resetar-2fa-adm` |
| Segredos | GitHub → Settings → Environments → **producao**. Os valores nunca vão para o código nem para o chat |

## 7. Como trabalhar neste repositório

- **Sem Docker na máquina do dono** (decisão dele). Tudo que usa banco roda **só no CI**: faça push num branch e acompanhe com `gh run watch <id> --exit-status`.
- Localmente rodam lint, typecheck, unidade, `npm run build:test` e o e2e simulado. O `.env.test` local leva valores falsos e é ignorado pelo git.
- O fluxo usado até aqui: **desenho → aprovação do dono (com mockups) → plano → implementação com testes → revisão de segurança → PR → merge pelo dono (= deploy)**.
- O dono prefere **publicar fluxos completos de uma vez**, não fases pela metade.
- Fale em **português do Brasil**, com passo a passo detalhado para ações no painel.
