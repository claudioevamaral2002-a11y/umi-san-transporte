# Fase 3B: plano de implementação

Especificação aprovada: [`fase-3b-desenho-execucao-rastreio.md`](fase-3b-desenho-execucao-rastreio.md) (18/10/2026, D1 a D5 como propostos). Execução **nativa** (um agente, revisão no fim), em TDD. Tudo num branch `fase-3b` e **um PR só** para a `main`.

O banco só é verificado no CI, porque não há Docker na máquina do dono. Cada tarefa de banco termina com um push no branch e o CI do PR verde.

## Tarefas

| # | Tarefa | Arquivos | Verificação |
|---|---|---|---|
| 1 | **Execução no banco:** colunas novas, `registrar_saida` (reserva → débito), `informar_previsao` (estende o bloco, marca o próximo), `concluir`, `pendencias` com "Atrasado" | `supabase/migrations/20261018120000_execucao.sql` | pgTAP `0025_execucao.test.sql` |
| 2 | **Rastreio e fotos no banco:** `app.posicoes`, `enviar_posicao`, `registrar_eta` (12 por viagem), tópico `rastreio:`, `app.fotos` + bucket `fotos` + `autorizar_foto`/`confirmar_foto`/`fotos_do_pedido`, `api.pedido` com as ações e os campos novos, limpeza de posições (cron) | `supabase/migrations/20261018120100_rastreio_fotos.sql`, `supabase/config.toml` | pgTAP `0026_rastreio_fotos.test.sql` |
| 3 | **Concorrência:** 10 saídas simultâneas → 1 débito; saída × cancelamento → um vence; canal `rastreio:` para N1 e não para N3 | `tests/integracao/execucao.test.ts` | CI (integração) |
| 4 | **Edge Function `enviar-foto`** (tipo real pelos bytes, 5 MB, permissão) e `Permissions-Policy: geolocation=(self)` | `supabase/functions/enviar-foto/`, `public/_headers`, `scripts/gerar-headers.ts`, `tests/e2e/seguranca.spec.ts` | integração + e2e |
| 5 | **Bibliotecas do front** (unidade): amostragem de posição, interpolação e "a última vence", estado do sinal, ETA descontando o tempo e troca para a origem, redução de foto, wrappers `execucao.ts` | `src/lib/rastreio.ts`, `src/lib/execucao.ts`, `src/lib/fotos.ts` | Vitest |
| 6 | **Motorista:** cartão "Próximo serviço", trilho "Deslize para sair", tela "Em andamento" (Wake Lock, envio de posição, selo), folha "Nova previsão", tela "Concluir" com fotos | `src/telas/execucao/*`, `src/design/componentes/TrilhoSair.tsx`, `Inicio.tsx`, `Pedido.tsx` | e2e simulado |
| 7 | **Cliente:** mapa ao vivo (Leaflet + blocos), sinal, ETA, aviso de atraso no próximo, linha do tempo com o carrinho, resumo do concluído com fotos | `src/telas/pedidos/MapaAoVivo.tsx`, `Pedido.tsx`, `componentes.tsx` | e2e simulado |
| 8 | **ADM:** "Corridas em andamento" no painel | `src/telas/adm/*` | e2e simulado |
| 9 | **e2e contra o banco real:** aprovado → saída → posições → conclusão → extrato com o débito | `tests/e2e/real/execucao.spec.ts` | CI |
| 10 | **Fechamento:** revisão de segurança, roteiro `fase-3b-o-que-testar.md`, RUNBOOK, HANDOFF, PR | docs | revisão |

## Regras que valem em todas as tarefas

- **Migrations:** só novas; nenhuma já publicada é editada. A guarda `0001_privilegios` continua verde.
- **RPCs:** `SECURITY DEFINER` com `search_path = ''`, devolvem `{ok, codigo}` e auditam as negações (Adendo A2). Os privilégios seguem o padrão `revoke all … grant execute … to authenticated`.
- **Ordem de travas:** atividade → conta, igual ao `cancelar_agendado`, para saída e cancelamento se excluírem.
- **Dinheiro:** nenhuma UI otimista na saída. A tela só muda depois da resposta do servidor.
- **Compatibilidade com o app aberto durante o deploy:** só se acrescentam colunas e funções.
- **`enviar_posicao`:** não audita o sucesso, porque roda a cada ~5 s. Audita as negações.
