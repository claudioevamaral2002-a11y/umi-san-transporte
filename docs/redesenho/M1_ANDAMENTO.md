# M1 — Solicitação em etapas e revisão

Status: em desenvolvimento. Este checkpoint entrega a revisão, não conclui o módulo.

## Implementado

- A ação da categoria abre “Revisar solicitação”; somente “Confirmar e enviar solicitação” chama `criar_pedido`.
- Resumo de origem, paradas, destino, categoria, horário, trajeto, passageiros/carga, horas, diárias, custos adicionais, contato, observações e centro de custo, conforme aplicável.
- Estimativa e memorial usam a resposta existente de `categorias_disponiveis`. A interface explicita que solicitação não é aprovação do orçamento.
- Voltar e editar preserva os campos. Folha modal existente mantém foco e permite fechar por teclado.
- Validação antes da revisão e do envio; horário de Agora é conferido novamente. Mudanças de horário exigem nova revisão.
- Bloqueio de reentrada durante envio e de revisão enquanto a prévia é recalculada. Falha inesperada de comunicação orienta conferir as corridas antes de repetir.
- Nenhuma alteração em src/lib, Supabase, autenticação, contratos RPC ou serviços.

## Verificação local — 01/11/2026

- Typecheck, lint e build v2: aprovados.
- 738 testes unitários aprovados.
- 59 E2E aprovados: novo-cliente, novo-acompanhar, novo-capacidade, novo-pedir-diarias e novo-pedir-paradas.
- Casos novos: revisão/edição sem envio em 390 e 1440 px; contato inválido impede revisão; Agora expirado impede envio.
- Axe sem violações nas revisões de 390 e 1440 px; sem rolagem horizontal. Capturas inspecionadas localmente; mapa e APIs simulados.
- Não representa teste contra produção ou confirmação de CI remoto.

## Preservação

C-17–C-34 continuam nos componentes existentes. C-33 passa por revisão antes da mesma RPC. As asserções de payload dos testes existentes foram mantidas, incluindo diarias_estimadas, horas_estimadas, volta_a_origem, paradas, capacidade e centro_custo. C-34 mantém a recuperação dos erros do servidor.

## Ainda necessário para concluir M1

- Reorganizar visualmente o início em “Para onde vamos?” e “Como vamos?”, com avanço explícito e rodapé de ação.
- Rascunho apenas em memória durante a sessão, preservado ao visitar Corridas e voltar e eliminado ao trocar conta/sair.
- Atalho de viagem agendada e cobertura do fluxo completo após a reorganização.
- Atualizar integralmente a matriz, validar o CI completo e preparar revisão final do módulo.

A correção da barra inferior é independente, no PR #49. Este ramo parte do main após o M0 e não inclui o PR #49. Nenhum merge ou deploy foi feito neste checkpoint.
