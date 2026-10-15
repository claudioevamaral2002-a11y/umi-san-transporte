# Handoff: fase 3A (endereços reais, distância e prévia) e o que vem depois

Estado em **14/10/2026**. Este documento passa o projeto de um chat (ou pessoa) para o próximo. Leia antes o [`HANDOFF.md`](HANDOFF.md), com as regras de ouro e a forma de trabalhar, e o [`docs/HANDOFF-redesign-mobile.md`](docs/HANDOFF-redesign-mobile.md).

## 1. Onde estamos

| Item | Estado |
|---|---|
| **PR #24** (5 correções mobile) | **Na `main` e em produção** desde 14/10 (deploy verde). |
| **PR #25** (`redesign-mobile` → `main`) | **Na `main`** desde 14/10. Atenção: as duas correções finais (fim do "pisca" e o cache entre contas) **não entraram** nesse merge, porque nunca tinham sido enviadas ao GitHub. Elas seguem na branch `fase-3a`. |
| **Branch `fase-3a`** (no GitHub) | Rebaseada na `main`. **Fase 3A implementada** (12 tarefas, CI verde) e PR aberto para a `main`, sem merge. Leva junto as duas correções acima. Atualização em 14/10. |
| **Chaves do Google** | **Pendentes, com o dono:** [RUNBOOK](RUNBOOK.md) item 16. Sem elas o app funciona em texto livre. Roteiro de produção: [`fases/fase-3a-o-que-testar.md`](fases/fase-3a-o-que-testar.md). |

Quando o PR #25 entrar na `main`, rode `git rebase main` na `fase-3a`, ou abra o PR da 3A já com base na `main`.

## 2. O que o dono pediu (14/10/2026)

1. "Mudar de página ou selecionar faz parecer que pisca": **feito**, no PR #25.
2. Uma nova fase, que ele chamou de "fase 2". Como as fases 2A e 2B já existem, ela virou a **fase 3**:
   - **3A: endereços reais, distância e prévia.** Ao digitar a origem e o destino, aparecem endereços reais. Os km entre os dois pontos são calculados, e "Confira o pedido" mostra uma prévia do orçamento pela tabela da empresa.
   - **3B: viagem em andamento e rastreio.** O cliente acompanha a localização do motorista, o percurso e a expectativa de chegada.
3. "Aplicar o REA ao sistema da Uber ou InDrive": **não descompilamos nada.** O dono aceitou estudar só o que é público (github.com/uber, o blog de engenharia e a documentação). O resumo e as fontes estão na §11 da especificação da 3A. O que serve à 3B está na §5 deste documento.

## 3. Decisões do dono

- **Fornecedor:** Google Maps Platform.
- **Distância:** é só estimativa. O motorista confirma ou ajusta os km no orçamento oficial, e a cobrança não muda.
- **Km:** só da origem até o destino. O retorno de 50% vem da tabela.
- **Local sem endereço:** marcar no mapa.
- **Locais da empresa:** sim, aparecem primeiro.
- **Prévia:** N1 e N2.
- **Rastreio (3B):** fazer a fase 3 de execução junto, no PWA, com o app aberto e a tela acesa (Wake Lock).
  - Quem vê: o solicitante, o N1, o ADM e o gestor de frota.
  - Retenção: o trajeto é apagado ao concluir. Fica só o resumo (km real, saída e chegada).
- **Custo do Google:** o dono entendeu as cotas gratuitas por serviço e o freio de 2.000 chamadas por dia por empresa. Ver a §6.1 da especificação.

## 4. Próximo passo: implementar a 3A

- **Especificação:** [`docs/fases/fase-3a-desenho-enderecos-previa.md`](docs/fases/fase-3a-desenho-enderecos-previa.md).
- **Mockups:** [`docs/redesign/mockups-fase-3a.html`](docs/redesign/mockups-fase-3a.html). Para ver: `cd docs && python -m http.server 8765`.
- **Plano** (12 tarefas, com TDD): [`docs/fases/fase-3a-plano.md`](docs/fases/fase-3a-plano.md).

**Antes de começar:**
1. Pergunte ao dono qual forma de execução ele prefere:
   - **com subagentes:** um agente novo por tarefa e outro revisando;
   - **nativa:** um agente só, com revisão final.

   Nesta rodada, o dono escolheu a nativa para o redesign.
2. Use as skills `superpowers:executing-plans` (ou `subagent-driven-development`) e `superpowers:test-driven-development`.
3. Na ordem do plano:
   - **Tarefas 1 a 4 (banco):** só dá para verificar no CI, porque não há Docker na máquina do dono. Faça push num branch e acompanhe com `"/c/Program Files/GitHub CLI/gh.exe" run watch <id> --exit-status`.
   - **Tarefas 5 a 11:** testes locais (Vitest e Playwright). Para o e2e local, deixe `npx wrangler pages dev dist --port 8788 --ip 127.0.0.1 --compatibility-date=2026-09-01` rodando em segundo plano, porque o servidor do Playwright às vezes passa de 60 s para subir no Windows.
4. **O dono precisa criar as chaves do Google** (RUNBOOK §Google Maps, escrito na Tarefa 12). Elas vão direto para os segredos do GitHub e do Supabase, **nunca pelo chat**. Até lá, o app cai no texto livre, por projeto.

**Cuidados que já custaram tempo:**
- **`npx prettier` baixa o Prettier**, que o projeto não usa, e reformata com ponto e vírgula. Não rode.
- **Editar arquivos com Python no Windows:** use `open(..., newline='')`. Sem isso, o arquivo vira CRLF.
- **Heredocs grandes no Bash com aspas misturadas falham.** Escreva o script num arquivo e execute-o.
- **`useConsulta`:** a opção `cache` **nunca** pode ser usada em leituras de dinheiro (saldo, extrato, créditos, prévia).
- **`interno.validar_pedido` recusa chaves desconhecidas.** Toda chave nova em `criar_pedido` precisa entrar ali também.

## 5. Depois: fase 3B (rastreio), ainda sem especificação

Recomendações do estudo público da Uber, adaptadas ao nosso tamanho. São inferências, com as fontes no relatório da sessão; confirmar ao especificar:
- **Amostragem:** `watchPosition` com alta precisão, mas **envio** no máximo a cada ~5 s, ou antes se o motorista andar mais de 50 m. Parado por mais de 60 s: só um heartbeat a cada ~30 s. Descartar leituras com `accuracy` acima de ~100 m.
- **Envio:** canal privado do Supabase Realtime por viagem, autorizado para o solicitante, o N1, o ADM e o gestor de frota. Payload `{lat,lng,heading,speed,accuracy,ts,seq}`. O cliente ignora `seq` antigo ("a última vence"). No banco, gravar a cada ~30 s ou ~200 m.
- **No mapa:**
  - o carro anda interpolando entre os pontos;
  - acima de 20 s sem dado: "atualizado há X s";
  - acima de 60 s: ícone cinza com "sinal do motorista perdido", sem inventar posição.
- **ETA:** a rota do Google calculada uma vez na saída. Durante a viagem, estimar pela fração percorrida. Recalcular só com desvio maior que ~300 m ou a cada 5 a 10 min, com limite por viagem no banco.
- **Mapa:** o mesmo Leaflet com blocos do Google da 3A, sem afrouxar a CSP.
- **Retenção (decisão do dono):** apagar as posições ao concluir e guardar só o resumo.
- **Depende da execução:** "deslize para sair", status em andamento, conclusão e débito, já previstos na especificação mestre (§12.2 e backlog da fase 3). O carrinho `DesenhoPickup` já está pronto para o "deslize para sair".
- **Fora do escopo agora:** app nativo e rastreio em segundo plano no iPhone (limite do PWA, explicado ao dono).

## 6. Pendências menores registradas (não bloqueiam)

As pendências do redesign estão no PR #25 e no `docs/HANDOFF-redesign-mobile.md` §1.1.

## 7. Como falar com o dono

- Português do Brasil, com passo a passo detalhado para ações em painéis (Google Cloud, GitHub, Supabase).
- Mostrar mockups antes de implementar telas novas.
- O merge é sempre dele, porque dispara o deploy.
- Ele prefere publicar fluxos completos de uma vez.
