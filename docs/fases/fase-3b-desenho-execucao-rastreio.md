# Fase 3B: execução da viagem e rastreio do motorista

Estado: **aprovada pelo dono em 18/10/2026**, com os mockups ([`../redesign/mockups-fase-3b.html`](../redesign/mockups-fase-3b.html)) e as propostas D1 a D5 da §3. Plano de implementação: [`fase-3b-plano.md`](fase-3b-plano.md).

> A 3B junta duas coisas que o dono pediu para fazer juntas:
> - a **fase 3 de execução** do backlog (issue #11): saída com débito, previsão de término e atraso, conclusão com fotos e linha do tempo;
> - o **rastreio**: o cliente acompanha no mapa onde o motorista está e a hora prevista de chegada.
>
> Ficam para depois: aditivo e revisão de contrato aprovado (#12), anexos e "Repetir pedido" (#13), e-mail e push (#14, fase 5).

## 1. Objetivo

O motorista conduz o serviço inteiro pelo app: sai, informa atraso se houver e conclui com fotos. Quem pediu acompanha ao vivo, sem precisar ligar para perguntar onde ele está.

**Sucesso é:**
- **saída segura:** o motorista desliza para sair, e numa única operação a reserva vira débito. Nunca há dois débitos, nem saída e cancelamento juntos;
- **mapa honesto:** o cliente vê o carro andando no mapa e a hora prevista de chegada. Quando o sinal cai, a tela diz isso em vez de inventar posição;
- **atraso visível:** se a viagem atrasar, a agenda se ajusta e o cliente do próximo pedido fica sabendo;
- **trajeto apagado:** ao concluir, o trajeto some e fica só o resumo (saída, chegada e km rodados);
- **segurança mantida:** a reconciliação diária continua sem divergências, e a CSP continua rígida.

## 2. Fluxo

```
AGENDADA ──(deslize para sair)──► EM_ANDAMENTO ──(concluir)──► CONCLUIDA
   │  reserva → débito, numa transação     │  posições a cada ~5 s (canal privado)
   │                                       │  "nova previsão" estende a agenda
   └─ cancelamento só até aqui             └─ fotos e observação
```

### 2.1 Antes de sair: cartão "Próximo serviço" (motorista)

No Início do motorista, o próximo AGENDADA vira um cartão grande (especificação §12.3), com:
- o horário e a rota (origem → destino);
- **Abrir no Google Maps / Waze**: link com o `place_id` ou com as coordenadas do ponto marcado. Nada fica guardado além do que já está no pedido;
- **Ligar para o contato**: `tel:`, quando houver telefone;
- **Deslize para sair**: aparece a partir de **60 min antes do início** (decisão D1).

### 2.2 Saída: `api.registrar_saida(p_atividade, p_chave)`

O carrinho percorre o trilho; ao soltar no fim, o app chama o servidor. **Nenhuma UI otimista** (regra de ouro 3): a animação de "partindo" fica até a resposta chegar, e só então a tela vira "Em andamento".

Numa transação, na mesma ordem de travas do `cancelar_agendado`, para que os dois se excluam:
1. trava o pedido (`for no key update`) e depois a conta (`interno.travar_conta`);
2. confere a idempotência (`interno.idempotencia_buscar`) e o rate limit;
3. confere quem pode sair (`interno.pode_orcar`: o motorista do pedido ou o ADM) e se o status é `AGENDADA`; senão, `STATUS_INVALIDO`;
4. confere a janela de saída (D1); senão, `FORA_DA_JANELA`;
5. libera a reserva (`LIBERACAO_RESERVA`) e lança o **DEBITO** do valor aprovado, apontando para o mesmo orçamento da reserva. Isso deixa a reconciliação limpa (`RESERVA_FORA_DE_AGENDADA` e `COBRANCA_SEM_APROVACAO` continuam zeradas);
6. `interno.transicionar(..., 'EM_ANDAMENTO')` e grava `saiu_em = now()`.

**Erros e concorrência:**
- uma `unique_violation` (o índice `lancamentos_um_debito` ou `atividades_uma_em_andamento`) vira `JA_PROCESSADO` ou `OUTRA_EM_ANDAMENTO`, auditados (Adendo A2);
- o disponível não muda na saída, porque o débito tem o mesmo valor que estava reservado. Muda só o contábil e o reservado.

### 2.3 Viagem em andamento (tela do motorista)

- **Tela acesa:** a tela "Em andamento" pede a Wake Lock e mostra "Mantenha o app aberto: o cliente está acompanhando você."
- **Localização:**
  - o app pede a localização na primeira saída, com uma explicação antes do pedido do navegador;
  - um selo fixo mostra "Compartilhando sua localização" enquanto a viagem durar.
- **Botões:**
  - **Nova previsão de término** (§2.5);
  - **Concluir** (§2.6);
  - **Ligar para o contato**;
  - **Abrir no Maps**.
- **Quando a localização falha:** se a pessoa negou ou o GPS não funciona, a viagem segue normalmente. O cliente vê "Localização indisponível" em vez do mapa.

### 2.4 Rastreio

**Envio** (no app do motorista):
- `watchPosition` com alta precisão;
- **envia** no máximo a cada **5 s**, ou antes se andou mais de **50 m**;
- **parado** por mais de 60 s: só um sinal de vida a cada **30 s**;
- **descarta** leituras com precisão pior que **100 m**.

**Caminho:** RPC `api.enviar_posicao(p_atividade, p jsonb)`, e não um INSERT direto no canal. Assim o servidor confere tudo:
- **quem envia:** o motorista do pedido, com o pedido `EM_ANDAMENTO`;
- **limites:** coordenadas válidas, precisão e no máximo 1 envio a cada 3 s (`interno.checar_limite`);
- **repasse:** `realtime.send` no tópico privado **`rastreio:<atividade>`**, com o payload `{lat, lng, rumo, velocidade, precisao, ts, seq, eta}`;
- **gravação:** grava em `app.posicoes` só a cada ~30 s ou ~200 m, o que basta para o resumo de km.

**Quem vê** (decisão do dono, 14/10): o **solicitante**, o **N1** da empresa, o **ADM** e o **gestor de frota**.
- Uma regra nova em `app.pode_ver_topico` cuida do prefixo `rastreio:`.
- O N3 e os outros N2 continuam vendo só o status.

**Tela do cliente** (no detalhe do pedido, com o pedido `EM_ANDAMENTO`):
- **mapa:** é o mesmo Leaflet da 3A, carregado sob demanda e com os blocos do Google, então nenhum `script-src` novo;
- **marcadores:** o carro e o destino;
- **movimento:** o carro anda **interpolando** entre os pontos e ignora `seq` antigo ("a última vence");
- **destino no mapa:** se o ponto foi marcado no mapa, usa as coordenadas guardadas. Se é do Google, faz um "detalhar" na hora e guarda o resultado só na memória da tela (termos do Google, 15/10);
- **sinal fraco:** acima de **20 s** sem dado, mostra "atualizado há X s";
- **sinal perdido:** acima de **60 s**, o carro fica cinza com "Sinal do motorista perdido". A tela nunca inventa posição.

**Hora prevista de chegada (ETA):**
- quem calcula é **o app do motorista**, pela ação `rota` da função `enderecos` (que já existe), e o valor vai junto no payload. Assim, cada pessoa assistindo não gera uma chamada paga a mais;
- **primeiro cálculo:** na saída;
- **recálculo:** só com desvio de mais de ~300 m da rota anterior, ou a cada 10 min;
- **limite:** **12 por viagem**, conferido no banco;
- **entre recálculos:** o app desconta o tempo decorrido;
- **ida e volta:** a 150 m do destino, a ETA passa a apontar para a origem, sem botão extra (D2).

**Retenção** (decisão do dono):
- **ao concluir:** `app.posicoes` da viagem é apagada na mesma transação, e ficam no pedido só `saiu_em`, `concluiu_em` e `km_rodados`, este somado das posições antes de apagar;
- **viagem esquecida:** o `expirar-vencidos` apaga posições com mais de 48 h, por garantia.

### 2.5 Previsão de término e atraso: `api.informar_previsao(p_atividade, p_fim, p_motivo)`

- **Quem e quando:** só o motorista do pedido ou o ADM, com o pedido em andamento. A nova hora fica entre agora e 24 h.
- **O que grava:** `fim_previsto`, e o bloco da agenda passa a ir até `fim_previsto`.
- **Se colidir com o próximo bloco do motorista:**
  - **agenda:** o bloco vai **só até o início do próximo**, sem desrespeitar a restrição de conflito;
  - **marcação:** o próximo pedido recebe `atraso_anterior_ate = fim_previsto`;
  - **aviso:** é publicado no tópico do próximo pedido, e o cliente dele vê "O motorista está terminando outro serviço; previsão de chegada ~HH:MM" no detalhe e nas pendências. A especificação §5 já prevê "atraso" nas pendências;
  - **saída do próximo:** ele continua sem poder sair antes deste concluir, por causa do índice `atividades_uma_em_andamento`.
- **Atrasado sem aviso:** passou o `fim_previsto`, ou `inicio + duração`, e o pedido segue em andamento. Então a tela do motorista mostra "Você passou da previsão. Informe uma nova." e o pedido entra nas pendências do motorista.
- **Pendência que some:** hoje `api.pendencias` esconde "próximos" vencidos (`inicio + duracao_min < now()`). Um pedido em andamento atrasado passa a aparecer como **"Atrasado"**, sem sumir.

### 2.6 Conclusão: `api.concluir(p_atividade, p_observacao)`

- **Quem:** só o motorista do pedido ou o ADM.
- **O que muda:** o pedido vai para `CONCLUIDA` e grava `concluiu_em`, `km_rodados` e a observação de até 1000 caracteres. **Não cobra nada** (especificação §4.5).
- **Na mesma transação:** desativa o bloco da agenda (`transicionar` já faz isso) e apaga as posições.

**Fotos** (especificação §8):
- **opcionais, até 10** (D3);
- **antes do envio:** o app reduz cada foto a ~1600 px em WebP (~300 KB);
- **envio:** pela Edge Function nova `enviar-foto`. Ela confere quem envia, o pedido em andamento ou concluído há menos de 24 h, o **tipo real pelos primeiros bytes** (JPEG, PNG, WebP), o limite de **5 MB** e o rate limit. Só então grava no bucket privado `fotos` com o nome em UUID;
- **registro:** cada foto vira uma linha em `app.fotos (atividade_id, caminho, enviada_em, entregue_em, apagada_em)`;
- **leitura:** por URL assinada curta, para quem pode ver o pedido;
- **retenção:** **nenhuma foto é apagada nesta fase.** A especificação §8 só permite apagar com a entrega por e-mail confirmada, e o e-mail vem na fase 5. O ADM já configura os dias de retenção, que passam a valer na fase 5.

### 2.7 Linha do tempo e status (todos)

- A `LinhaDoTempo` ganha o carrinho avançando entre **Agendado → Saiu → Em andamento → Concluído** (especificação §12.2). Com `prefers-reduced-motion`, vira uma troca simples.
- No concluído, o resumo mostra:
  - saída e chegada (horas);
  - duração real;
  - km rodados ("pelo GPS do motorista, aproximado");
  - as fotos;
  - a observação.
- **Painel do ADM:** o cartão "Corridas em andamento" (Adendo A10) lista as viagens com status, previsão e link para o mapa.

## 3. Decisões do dono

Já decidido (14/10): rastreio no PWA com o app aberto e a tela acesa; quem vê o mapa; trajeto apagado ao concluir.

**Para decidir agora** (a proposta vem primeiro):

| # | Tema | Proposta | Alternativa |
|---|---|---|---|
| D1 | Quando o motorista pode sair | A partir de **60 min antes** do início, sem limite depois | Só a partir do horário marcado |
| D2 | Chegada ao destino, em ida e volta | **Automática** (a 150 m do destino) | Botão "Cheguei" |
| D3 | Fotos na conclusão | **Opcionais**, até 10 | Ao menos 1 foto obrigatória |
| D4 | Atraso que colide com o próximo pedido | Aviso **dentro do app** para o cliente do próximo; e-mail e push na fase 5 | Esperar a fase 5 |
| D5 | Saída sem GPS (negado ou falhando) | **Permitir**; o cliente vê "Localização indisponível" | Bloquear a saída sem GPS |

## 4. Dados (migrations novas; nenhuma antiga é editada)

- **`app.atividades`:** `saiu_em`, `concluiu_em`, `fim_previsto`, `atraso_anterior_ate`, `km_rodados numeric(7,1)`, `observacao_conclusao`.
- **`app.posicoes`:**
  - colunas: `atividade_id`, `em`, `lat`, `lng`, `precisao`, `seq`;
  - acesso: **sem leitura nem escrita para usuários**, só pelas funções;
  - índice por `(atividade_id, em)`.
- **`app.eta_calculos`:** contador de ETAs por viagem, para o limite de 12, ou uma coluna `etas_usadas` no pedido.
- **`app.fotos`** e o bucket privado **`fotos`** (5 MB, `image/jpeg|png|webp`):
  - escrita: só a função `enviar-foto`, com a service role;
  - leitura: pelo `interno.pode_ver_atividade`.
- **`app.pode_ver_topico`:** prefixo `rastreio:` com a regra de quem vê (§2.4).
- **`api.pedido`:**
  - as `acoes` ganham `sair`, `informar_previsao` e `concluir`;
  - o detalhe ganha os campos novos, as fotos (caminhos) e `pode_ver_rastreio`.
- **Funções novas:** `api.registrar_saida`, `api.informar_previsao`, `api.concluir`, `api.enviar_posicao`, `api.fotos_do_pedido`. Todas são `SECURITY DEFINER` com `search_path = ''`, devolvem `{ok, codigo}`, auditam as negações (Adendo A2) e entram na guarda `0001_privilegios`.
- **Códigos novos** em `erros.ts`: `FORA_DA_JANELA`, `OUTRA_EM_ANDAMENTO`, `PREVISAO_INVALIDA`, `LIMITE_ETA`, `FOTO_INVALIDA`.

**Compatibilidade com o app aberto durante o deploy** (lição de 15/10): só se acrescentam funções e colunas. Nada que o app atual envia passa a ser recusado.

## 5. Segurança e privacidade

- **`Permissions-Policy`:** muda de `geolocation=()` para **`geolocation=(self)`**, e o `seguranca.spec.ts` acompanha. `camera=(self)` já existe e serve para as fotos.
- **Posição só quando deve:**
  - o motorista só envia posição de pedido em andamento seu, e o servidor recusa o resto;
  - nada é enviado antes da saída nem depois da conclusão;
  - o app para o `watchPosition` ao sair da tela de viagem ou ao concluir.
- **Canal fechado:** o canal `rastreio:` é privado. Clientes não publicam nele, porque nenhuma política de INSERT é criada em `realtime.messages`.
- **Transparência com o motorista (LGPD):** um aviso único antes da primeira viagem explica o que é compartilhado, com quem e por quanto tempo, e o selo fica visível durante a viagem. Base legal: execução do contrato de transporte.
- **Fotos:** tipo verificado pelos bytes, nome em UUID, URL assinada curta, bucket privado e nenhuma URL pública.

## 6. Custo esperado

- **Realtime** (Supabase Free: 2 milhões de mensagens/mês):
  - 1 posição a cada 5 s ≈ 720 por hora de viagem, vezes quem está olhando;
  - **exemplo:** 60 viagens de 2 h por mês, com 2 pessoas olhando, dá ~170 mil mensagens, menos de 10% da cota.
- **Google:**
  - ETA: até 12 rotas por viagem (Routes, faixa Essentials);
  - mapa: blocos do mapa por sessão de quem olha;
  - destino: 1 "detalhar" por abertura de tela quando o destino é do Google;
  - tudo continua dentro das cotas gratuitas mensais, com o teto diário por empresa da 3A valendo também aqui.
- **Fotos** (Storage Free: 1 GB):
  - a ~300 KB por foto, 5 fotos por viagem: ~1,5 MB por viagem, ou ~650 viagens até 1 GB;
  - como nada é apagado até a fase 5, o painel do ADM mostra o uso do bucket (risco aceito, §10).

## 7. Telas (mockups em `docs/redesign/mockups-fase-3b.html`)

1. **Motorista, Início:** cartão "Próximo serviço" com o trilho "Deslize para sair".
2. **Motorista, saindo:** a pickup parte, e a tela espera o servidor confirmar.
3. **Motorista, Em andamento:** selo de localização, previsão, "Nova previsão", "Concluir".
4. **Motorista, Nova previsão:** folha com horários em passos de 15 min e motivo opcional.
5. **Motorista, Concluir:** fotos (miniaturas), observação, "Concluir serviço".
6. **Cliente, acompanhando:** mapa com o carro, chegada prevista, linha do tempo e sinal.
7. **Cliente, sinal perdido:** carro cinza com "Sinal do motorista perdido · última posição há 2 min".
8. **Cliente, próximo pedido com atraso:** aviso no detalhe e nas pendências.
9. **Concluído:** resumo com horas, km, fotos e observação.

## 8. Testes

- **pgTAP:**
  - saída: libera a reserva e lança 1 débito do valor aprovado; status e `saiu_em`;
  - saída fora da janela, de outra pessoa ou de status errado: recusada e auditada;
  - saída × cancelamento e 10 saídas simultâneas: só um vence (também na integração);
  - previsão: estende o bloco; colisão marca o próximo; previsão inválida recusada;
  - conclusão: apaga as posições, grava o resumo e não lança nada no livro-razão;
  - `enviar_posicao`: recusa sem `EM_ANDAMENTO`, de outra pessoa, com coordenada inválida ou acima da taxa;
  - `pode_ver_topico('rastreio:…')`: solicitante, N1, ADM e gestor sim; N3 e outro N2 não;
  - reconciliação depois de saídas e conclusões: zero divergências;
  - guarda `0001_privilegios` verde.
- **Integração** (concorrência real):
  - 10 saídas simultâneas dão 1 débito;
  - saída e cancelamento simultâneos: um só vence;
  - o canal `rastreio:` entrega ao N1 e não ao N3.
- **Edge Function `enviar-foto`:** recusa um arquivo que não é imagem com extensão `.jpg`, arquivos acima de 5 MB, quem não pode e pedido concluído há mais de 24 h.
- **Unidade:**
  - amostragem (5 s, 50 m, sinal de vida, precisão);
  - interpolação e "a última vence";
  - ETA descontando o tempo;
  - troca para a origem em ida e volta;
  - estados do sinal (20 s, 60 s);
  - redução de foto.
- **e2e (simulados):**
  - trilho de saída: só confirma no fim, com teclado acessível e reduced motion, sem otimismo;
  - posições falsas movendo o carro; sinal perdido;
  - nova previsão; concluir com fotos;
  - quem vê e quem não vê o mapa.
- **e2e contra o banco real (CI):** pedido aprovado → saída → posições → conclusão → extrato com o débito.
- **Roteiro de produção:** `docs/fases/fase-3b-o-que-testar.md` (no celular, com o dono como cliente num aparelho e motorista no outro).

## 9. Ordem de implementação (o plano detalhado vem depois da aprovação)

1. **Banco:** colunas, saída e débito, previsão, conclusão, posições, tópico, fotos e pgTAP. Só dá para verificar no CI.
2. **Edge Function** `enviar-foto` e o `Permissions-Policy`.
3. **Motorista:** cartão, trilho, tela em andamento, envio de posição, previsão, conclusão e fotos.
4. **Cliente:** mapa ao vivo, sinal, ETA, aviso de atraso, linha do tempo e resumo.
5. **ADM:** corridas em andamento.
6. **Revisão de segurança**, depois **um PR só** (o dono prefere publicar o fluxo completo).

## 10. Riscos aceitos

- **iPhone sem rastreio em segundo plano:** com a tela apagada ou outro app na frente, o envio para. O cliente vê "sinal perdido" (limite do PWA, já explicado ao dono). O app nativo fica fora do escopo.
- **Km rodados aproximados:** saem de pontos a cada ~30 s e servem de informação, não de cobrança. A cobrança é sempre o orçamento aprovado.
- **Fotos acumulando** até a fase 5 (§6), monitoradas no painel.
- **ETA estimada:** uma estimativa entre recálculos; pode errar com trânsito.
