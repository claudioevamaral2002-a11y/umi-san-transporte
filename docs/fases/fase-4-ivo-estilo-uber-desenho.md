# Fase 4: o IVO no estilo Uber (MVP em PWA)

Estado: **aprovada pelo dono em 19/10/2026**, com os mockups; **implementada no branch `fase-4`** (em teste no ivo-novo.pages.dev, antes do merge). As decisões vieram de uma conversa com ele no mesmo dia. Mockups: [`../redesign/mockups-fase-4.html`](../redesign/mockups-fase-4.html).

> **Por que "fase 4".** O dono chamou de fase 4 o acompanhamento dos motoristas. Esse acompanhamento já estava pronto na 3B, mas tinha três problemas de configuração, todos resolvidos em 19/10: o app instalado estava preso numa versão antiga, a chave do mapa estava bloqueada para a Map Tiles API e a chave estava colada duas vezes no GitHub. Depois do teste, o dono pediu outra coisa: **refazer a experiência no modelo da Uber** (InDrive, V1 e Rhinos também servem de referência), com pouco texto e mais mapa, mantendo a identidade da IVO. Essa é a fase 4.

## 1. Objetivo

Um funcionário da empresa cliente abre o app e cai num **mapa**. Ele escolhe de onde e para onde, vê o **trajeto desenhado** e o **preço estimado de cada tipo de transporte**, escolhe um e agenda. A chamada chega ao motorista, que **aceita o valor ou propõe outro**. O cliente confirma e informa o **centro de custo**. No dia, o motorista dirige com a **rota no próprio app**, e o cliente acompanha o carro no mapa até o fim.

Nas palavras do dono: *"uma plataforma com menos texto, mais mapas, mais focada no usuário e no que ele precisa, onde as informações adicionais sejam secundárias, e foque na corrida"*.

**Sucesso é:**
- pedir uma corrida leva **poucos toques**, e o mapa fica sempre na frente;
- o cliente vê o **preço estimado antes de pedir**, para cada categoria;
- o motorista responde a uma chamada **com um toque** (aceitar) ou dois (propor outro valor);
- o motorista **não precisa sair do app** para ver o caminho, e o "Abrir no Waze" continua lá;
- todas as **regras de dinheiro** de hoje continuam valendo (reserva, débito na saída, livro-razão, reconciliação), sem regressão;
- o app atual **continua no ar, sem mudança**, até o dono aprovar a troca.

## 2. Decisões do dono (19/10/2026)

| Tema | Decisão |
|---|---|
| Plataforma | **PWA no MVP**, como hoje. O app de loja (rastreio com a tela apagada, voz curva a curva) fica para depois |
| Banco | **O mesmo banco de hoje.** Usuários, empresas, contratos, saldos e regras continuam. Mudanças no banco só **acrescentam** (lição de 15/10) |
| Onde testar | **Endereço separado**, instalável no celular, **sem substituir a produção**. Usa o mesmo banco, porque hoje os dados são de teste ("tudo hoje é de mentira") |
| Motoristas | **Só o Ivo** por enquanto. A chamada vai para ele. Vários motoristas vêm numa atualização futura, no modelo "um por vez, o mais perto primeiro" (escolha do dono no esboço) |
| Preço | O motorista **pode propor outro valor**. O cliente aceita ou recusa |
| Categorias | **IVO Passageiros, IVO Carga Leve e IVO Carga Pesada** (exemplos do dono), **cada uma com o seu preço**. A tabela do contrato é adaptada |
| Quando | **Agendar é o mais comum**: a tela abre em "Agendar", e "Agora" é uma opção, que vale como "o mais cedo possível, a partir de 1 hora" (§6.1) |
| Centro de custo | **Digitado** pelo cliente, ao confirmar a corrida |
| Menu | **Ícone no canto superior esquerdo**, com Perfil, Carteira, Agenda e outros itens |
| Veículos | O motorista **cadastra os veículos** e as **categorias que cada um atende** |
| "Nova previsão de término" | **Não faz sentido para o motorista**, porque a distância é que dita a chegada. Sai da tela dele (§6.4) |
| Painel de gestão | **Entra nesta versão** (19/10, depois da aprovação, com a referência do site da Rhino for Business): um painel no computador para quem gerencia a empresa cliente (§6.9) |
| Repositório | O dono pediu primeiro um repositório novo. Na conversa, com o mesmo banco e o teste num endereço separado, ficou **o repositório atual**: um só lugar para as regras do banco e uma só publicação. Ele pode voltar atrás (§11) |

## 3. Fora de escopo (MVP)

- **App de loja** (Android/iPhone), **rastreio em segundo plano** e **voz curva a curva**. O motivo é o custo e as regras das lojas; ver a §10.
- **Vários motoristas** e o despacho automático. O banco já fica pronto para isso (§5.3), mas a tela só trata o Ivo.
- **Rastreio fora da corrida.** Ficar "Disponível" não compartilha a localização (privacidade do motorista e LGPD).
- **Notificação com o app fechado** (push e e-mail). Isso é da fase 5. Até lá, a chamada toca **com o app aberto** (risco na §12).
- Lista fixa de centros de custo. É texto livre agora.
- Telas do ADM redesenhadas. O ADM continua com as telas atuais, alcançadas pelo menu. A exceção são duas telas novas e simples no app novo: **Categorias e preços** e **Veículos** (§6.7). O app atual não muda.
- Categoria **"Motorista"** (o Ivo dirigindo o veículo da empresa, cobrado por diária). Isso continua possível só pelo app atual, como hoje, e entra no app novo depois. *(Decisão minha: o dono citou só as três categorias, e esta funciona diferente em tudo.)*

## 4. Arquitetura

```
Repositório atual (um só)
├─ supabase/           banco: migrations novas, só acrescentando (as duas interfaces usam)
├─ src/                app atual (sem mudança de comportamento)
└─ src/novo/ (nome do construtor)   interface nova, com os componentes de src/design reaproveitados
            │
GitHub Actions: CI (o mesmo) → Deploy da main publica DOIS sites no Cloudflare Pages
            ├─ umi-san-transporte.pages.dev   ← app atual (como hoje)
            └─ <endereço de teste>.pages.dev  ← app novo (PWA próprio, instalável à parte)
```

- **Dois sites, uma publicação.** Os dois saem do mesmo commit da `main`. Assim, uma mudança no banco e as duas interfaces que a usam sobem juntas, sem ordem a coordenar. Como separar as interfaces (uma variável de build ou uma entrada própria do Vite) fica com o construtor.
- **Endereço de teste.** É um segundo projeto no Cloudflare Pages. Proposta: `ivo-novo.pages.dev`; o dono confirma o nome. Origem própria significa PWA, service worker e instalação próprios, sem mexer no app atual.
- **Configuração para o endereço novo** (o dono faz, com passo a passo na hora; ver a §9): URL de retorno no Supabase Auth, domínio no Turnstile e referenciador da chave do mapa (`navegador-mapa`) no Google.
- **CSP e Permissions-Policy** iguais às do app atual. Nenhum `script-src` novo: o mapa continua Leaflet com os blocos da Map Tiles API.
- **Troca no fim.** Quando o dono aprovar, o app novo passa a ser servido em `umi-san-transporte.pages.dev`. A forma de fazer isso é decidida no plano.
- **Atualização do PWA.** O problema de 19/10 (app instalado preso numa versão antiga) tem uma proposta de correção separada. O app novo **já nasce com ela**: aviso "Nova versão · Atualizar" e nada de shell antigo servido indefinidamente.

## 5. Dados (migrations novas; nenhuma antiga é editada)

### 5.1 Categorias e preço por categoria

- **`app.categorias`**: catálogo da IVO, editado pelo ADM.
  - colunas: `codigo` (`PASSAGEIROS`, `CARGA_LEVE`, `CARGA_PESADA`), `nome` ("IVO Passageiros"…), `descricao_curta` ("até 4 pessoas"), `ordem`, `ativa`;
  - cada categoria **diz como preencher o pedido de hoje**: `carga` (PESSOAS/EQUIPAMENTO/AMBOS) e `reboque` (SIM/NAO). A `modalidade` é sempre VEICULO_PROPRIO.
  - Minha proposta para essa correspondência: Passageiros = PESSOAS, sem reboque; Carga Leve = EQUIPAMENTO, sem reboque; Carga Pesada = EQUIPAMENTO, com reboque. Assim o resto do sistema (agenda, saída, conclusão) não precisa mudar.
- **Preço por categoria no contrato.** Cada versão de contrato (`app.contratos_versoes`, imutável e publicada pelo ADM) ganha os preços de cada categoria. Proposta: uma tabela filha `app.contratos_categorias (versao_id, categoria, km_cent, taxa_fixa_cent)`, publicada junto com a versão.
  - Retorno de trecho único, hora de espera, hospedagem, pedágio, faixas de cancelamento, prazos e limite de crédito **continuam comuns** a todas as categorias.
  - **Publicação:** pela tela nova "Categorias e preços" do app novo (§6.7), criando uma versão nova do contrato, como hoje: imutável, só o ADM, a partir do contrato modelo ou de uma empresa.
- **Compatibilidade:**
  - contratos já publicados não têm preço por categoria. Cada categoria cai nos campos atuais: Passageiros e Carga Leve usam `km_sem_reboque_cent`; Carga Pesada usa `km_com_reboque_cent` mais `taxa_fixa_reboque_cent`. Assim, nada que está em produção muda de preço;
  - o app atual continua criando pedidos sem categoria, e eles valem como hoje.
- **Cálculo.** `interno.calcular_linhas` recebe a categoria e usa o preço dela. **O preço sempre vem do contrato**, e a entrada traz só quantidades (regra de hoje).

### 5.2 Pedido

Colunas novas em `app.atividades`:
- `categoria` (nula nos pedidos antigos);
- `veiculo_id` (o veículo que vai fazer a corrida; ver a §5.3);
- `centro_custo text` (até 80 caracteres, preenchido na confirmação);
- `avaliacao smallint` (1 a 5) e `avaliacao_comentario` (até 500 caracteres; ver a §6.6).

### 5.3 Veículos

- **`app.veiculos`**:
  - colunas: `id`, `motorista_id`, `modelo`, `cor`, `placa`, `lugares`, `carga_max_kg`, `reboque_desc` (opcional), `categorias` (lista), `situacao` (`ATIVO`, `MANUTENCAO`, `INATIVO`), `criado_em`;
  - escrita: só pelas RPCs. O motorista mexe nos veículos dele, e o ADM em todos.
- **Na chamada**, o app sugere o veículo ativo do motorista que atende a categoria. O motorista pode trocar antes de aceitar.
- **Sem veículo para a categoria** (por exemplo, o reboque em manutenção): a categoria aparece para o cliente como **"Indisponível no momento"** e não pode ser pedida. O banco recusa o orçamento de um pedido com categoria sem um `veiculo_id` ativo daquele motorista que atenda a categoria. *(Decisão minha.)*
- **O cliente vê** modelo, cor e placa a partir da confirmação.
- **Futuro** (fora do MVP): com vários motoristas, a chamada vai para quem tem um veículo ativo da categoria. Por isso a categoria fica no veículo, não no motorista.

### 5.4 Proposta de outro valor

**Ajustado em 19/10, a pedido do dono:** a contraproposta é feita na **calculadora**, como no "Orçar" de hoje. Um teclado de valor livre obrigaria o motorista a fazer a conta por fora.

- **"Propor outro valor"** abre a calculadora com os itens do contrato:
  - km rodados, com o botão − / + e o km da rota como referência;
  - espera em horas;
  - pedágio/balsa;
  - hospedagem em diárias;
  - "Outros" (descrição e valor, até 5, que já existe no cálculo).
- O reboque fica fixo pela categoria.
- O total é **recalculado pelo banco** a cada mudança (`calcular_orcamento`, sem gravar). A tela mostra "Pela tabela R$ X" e o novo total, com a diferença.
- **O cliente vê o memorial linha a linha** (km, retorno, espera, pedágio, outros…), então o que mudou fica explicado sem motivo à parte.
- **No banco, nada muda em relação ao que já está pronto:** o envio é o `enviar_orcamento` com as quantidades. A linha `AJUSTE_MOTORISTA` (valor livre com motivo, de −50% a +100%) continua aceita pelo banco, mas **a tela não a usa** nesta versão.
- O cliente vê o valor proposto e **aceita ou recusa**:
  - aceitar é a aprovação de hoje, com reserva no saldo;
  - recusar é "pedir revisão" (volta ao motorista) ou "reprovar" (encerra). Os dois já existem.

### 5.5 RPCs

Todas `SECURITY DEFINER` com `search_path = ''`, devolvendo `{ok, codigo}`, auditando as negações (Adendo A2) e cobertas pela guarda `0001_privilegios`.

- **Novas:**
  - `api.categorias_disponiveis(p jsonb)`: devolve as categorias ativas com o **preço estimado** de cada uma para a rota (km vindo da função `enderecos`). É a prévia de hoje, por categoria;
  - `api.meus_veiculos()`, `api.salvar_veiculo(p)`, `api.mudar_situacao_veiculo(p_id, p_situacao)`;
  - `api.avaliar(p_atividade, p_nota, p_comentario)`: só o solicitante ou o N1, só com o pedido concluído, uma vez só.
- **Versões novas, aceitando campos novos opcionais** (o app atual continua chamando como hoje):
  - `criar_pedido`: aceita `categoria`;
  - `enviar_orcamento`: aceita `veiculo_id`, `ajuste_cent` e `ajuste_motivo`;
  - `aprovar_orcamento`: aceita `centro_custo`.
  - Se mudar a assinatura for arriscado, criar funções novas (`_v2`). Isso fica com o construtor.
- **Sem mudança:** saída com débito, posição, ETA, conclusão, fotos, cancelamento com multa e saldo.

### 5.6 Rota desenhada

- A ação `rota` da função `enderecos` hoje devolve só distância e duração.
- Ela passa a devolver também a **linha do trajeto** (`polyline`), para desenhar no mapa.
- **A linha não é guardada no banco** (termos do Google: do Google, o pedido guarda só o `place_id`). Fica só na memória da tela.
- O custo continua sendo uma chamada da Routes API por cálculo, dentro do teto diário por empresa da 3A.

## 6. Telas e fluxo

Princípio: **o mapa na frente, uma ação por vez, o resto em "Detalhes"**. Cores, tipografia (Manrope), ícones, claro e escuro seguem o design system atual (`src/design`, `docs/marca`). Sem barra de abas embaixo; a navegação fica no **menu do canto superior esquerdo**.

### 6.1 Cliente pede (N1 e N2)

1. Abre direto no **mapa**, centrado na empresa, com o botão de menu (☰) no topo à esquerda.
2. **"Para onde?"**: busca com os locais da empresa primeiro, depois o Google, e "Marcar no mapa" (como na 3A). A origem já vem preenchida com o local principal da empresa.
3. Com origem e destino, o mapa **desenha o trajeto** e sobe uma folha com as **categorias**: nome, uma linha de descrição, tempo estimado e **"~R$ 180" (estimado)**. A mais usada pela empresa vem selecionada.
4. **Quando:** um seletor "**Agendar** ▾ · qua 22/10, 08:30" (padrão), com "Agora" como opção. Usa os horários livres da agenda (`api.horarios_livres`), como hoje.
5. **"Detalhes da corrida"** (opcional e recolhido): pessoas, descrição da carga, contato no local, ida e volta, observação.
6. Botão **"Pedir IVO Passageiros · qua 08:30"**. O pedido nasce SOLICITADA com pré-reserva na agenda, como hoje.
7. Tela de espera: "**Enviado ao Ivo.** Ele responde até HH:MM". O prazo vem de `prazo_orcar_horas` do contrato.

> **"Agora" (decisão do dono, 19/10):** significa **"o mais cedo possível, a partir de 1 hora"**.
> - O início gravado é o primeiro horário livre do Ivo a partir de agora + 60 min, arredondado aos passos da agenda.
> - O Ivo tem **15 min** para responder (`prazo_orcar_ate`), e o cliente tem **15 min** para confirmar a proposta (validade do orçamento nesse caso).
> - A janela de saída (60 min antes do início) não muda. Então, para um "Agora", o Ivo pode sair assim que o cliente confirmar.
> - Esses dois prazos de 15 min valem só para o "Agora". Os agendados seguem os prazos do contrato.

### 6.2 Motorista responde (Ivo)

- **A chamada:** com o app aberto, a chamada aparece em tela cheia com **som e vibração**. Mostra:
  - mapa com o trajeto, categoria, empresa, dia e hora;
  - km, tempo estimado e **valor pela tabela**;
  - o veículo sugerido, que dá para trocar.
- **Botões:** **"Aceitar por R$ 180"** e **"Propor outro valor"**. Esse segundo abre a **calculadora** (§5.4) com o total recalculado pelo contrato a cada mudança.
- **Recusar** continua existindo, com motivo (`recusar_pedido`), num item secundário.
- **Com o app fechado**, a chamada fica na lista de **Pendências** ao abrir. Push só na fase 5.
- **Os km:** vêm da rota, e o motorista pode ajustar como hoje no Orçar. Espera, pedágio e hospedagem ficam num "Mais itens" recolhido.

### 6.3 Cliente confirma

- **Folha com:** foto e nome do motorista, veículo (modelo, cor e placa), dia e hora, e o **valor**. Se o Ivo propôs outro valor, mostra "Pela tabela R$ 180 · Proposta do Ivo R$ 220", o resumo do que mudou (por exemplo, "48 km, 1 h de espera, pedágio") e "Ver o cálculo".
- **Campo "Centro de custo"**: texto livre, com o último valor que a pessoa usou já preenchido. **Opcional** no MVP. *(Decisão minha. Torná-lo obrigatório por empresa pode vir depois.)*
- **"Disponível no saldo: R$ X"**. O saldo insuficiente aparece antes do botão, com a mesma regra de hoje.
- **Botões:** **"Confirmar corrida"** (aprovação com reserva), "Pedir outro valor" (revisão) e "Recusar" (reprovar).
- **Quem pode confirmar:** só quem pode hoje (N1, ou N2 dono do pedido).

### 6.4 No dia: saída e viagem (motorista)

- **Início do motorista:** mapa com o **próximo serviço** num cartão embaixo e o trilho **"Deslize para sair"**, liberado 60 min antes, igual à 3B.
- **Em andamento, o mapa ocupa a tela:**
  - **trajeto desenhado** da posição atual até o destino, recalculado se ele desviar, dentro do limite de 12 cálculos por viagem da 3B;
  - **chegada prevista** grande, km restantes e selo "Compartilhando localização";
  - botões: **Abrir no Waze / Google Maps**, **Ligar** e **Concluir**;
  - a tela mantém o celular aceso (Wake Lock).
- **Sem instruções curva a curva** ("vire à direita em 300 m"): os termos do Google proíbem fazer navegação curva a curva com a Routes API, e isso só é permitido com o Navigation SDK, que é nativo. O Waze cobre isso.
- **Aviso ao trocar para o Waze:** "Enquanto o Waze estiver na frente, o cliente vê 'sinal perdido'. Volte ao IVO quando puder". Esse é o limite do PWA (§10).
- **"Nova previsão de término" sai da tela do motorista.** O atraso passa a ser calculado sozinho:
  - quando a chegada prevista + `duracao_min` restante passa do início do próximo serviço do motorista, o sistema marca o próximo pedido (`atraso_anterior_ate`, já existente) e avisa o cliente dele;
  - o **ADM** mantém a "Nova previsão" manual para casos especiais.

### 6.5 Cliente acompanha

- **Mapa em tela cheia** com o carro, o trajeto e o destino. Embaixo, **chegada prevista** grande, motorista e veículo, "atualizado agora" e os botões Ligar e Compartilhar (link de leitura fica fora do MVP; o botão só copia "IVO a caminho, chegada ~10:12").
- **Ao abrir no meio da viagem**, aparece logo a **última posição conhecida** (a última gravada em `app.posicoes`). Assim a tela não mostra "—" esperando o próximo envio.
- **Se o mapa falhar** (Google fora, chave…), a tela tenta de novo sozinha a cada 15 s. Isso corrige o que aconteceu em 19/10.
- Sinal fraco e sinal perdido funcionam como na 3B.

### 6.6 Fim

- **Cliente:** "Corrida concluída", com horário de saída → chegada, km, valor e centro de custo, as fotos, a **avaliação de 1 a 5 estrelas** (opcional) e **"Pedir de novo"**. Esse botão abre o pedido com a mesma rota e a mesma categoria, só faltando escolher a data. É a issue #13.
- **Motorista:** a mesma conclusão da 3B (fotos opcionais e observação). No fim, o **valor da corrida**.

### 6.7 Menu (☰, canto superior esquerdo)

| Cliente | Motorista | ADM / gestor |
|---|---|---|
| Minhas corridas (próximas e passadas) | **Disponível para chamadas** (liga/desliga; não compartilha localização) | Painel e Corridas em andamento |
| Agenda | Minhas corridas e Pendências | Os itens de hoje: contratos, créditos, usuários, empresas, configurações, auditoria (telas atuais) |
| **Carteira da empresa**: saldo, extrato (CSV/PDF com a coluna centro de custo) | Agenda | **Categorias e preços** (tela nova: nome, descrição, ativa, e o preço por km e a taxa de cada categoria numa versão nova do contrato) |
| Locais salvos | **Meus veículos** | **Veículos** (tela nova: os de todos os motoristas) |
| Equipe e **Painel da empresa** (só N1) | **Corridas do mês** (quantas e o total cobrado dos clientes; não é o repasse ao motorista, que ainda não existe) | Perfil e segurança |
| Perfil e segurança (senha, 2FA) | Perfil e segurança | Ajuda |
| Ajuda | Ajuda | |

### 6.8 Meus veículos (motorista)

- **Lista** de cartões com modelo, cor, placa, situação e as categorias que cada veículo atende, como etiquetas.
- **"+ Cadastrar veículo":** modelo, cor, placa, lugares, carga máxima, reboque (opcional) e as categorias. Foto e documento ficam para depois.
- **Situação:** Ativo, Em manutenção ou Inativo. O veículo em manutenção não aparece na chamada.

### 6.9 Painel de gestão da empresa (N1, no computador)

Acrescentado em 19/10, depois da aprovação, a pedido do dono. A referência é o site da Rhino for Business (vamosrhino.com): resumo do mês, próximas corridas, corridas recentes e pessoas.

- **Quem vê:** o **N1** da empresa, no menu como **"Painel da empresa"**. O ADM vê o de qualquer empresa, escolhendo a empresa no topo. O N2 e o N3 não veem.
- **Onde:** no app novo, em `/empresa`, com o layout largo pensado para o computador. No celular, as tabelas viram cartões empilhados.
- **Blocos, de cima para baixo:**
  1. **Resumo de {mês}:**
     - "Gasto no mês" = soma dos DÉBITOS do mês menos os ESTORNOS, com a barra de quanto isso representa do total disponível no começo do mês. Proposta minha: total = saldo no início do mês + recargas do mês + limite de crédito;
     - **"Disponível agora"** = o disponível de hoje (`interno.saldos`);
     - **"Reservado"** = corridas confirmadas que ainda não saíram;
     - Sem botão de recarregar, porque a recarga é só do ADM. No lugar, aparece "Para recarregar, fale com a IVO", com o telefone ou WhatsApp das Configurações.
  2. **Próximas corridas:** SOLICITADA, ORCADA e AGENDADA. Colunas: Quem pediu, Data, Roteiro (hora de saída → origem; hora prevista → destino), Categoria, Centro de custo, Status e Valor (o confirmado; ou "~estimado" quando ainda não há orçamento). "Ver todas" leva à lista filtrada.
  3. **Corridas recentes:** EM_ANDAMENTO, CONCLUIDA, CANCELADA, RECUSADA, REPROVADA e EXPIRADA dos últimos 30 dias, com as mesmas colunas.
     - Status com cor: **A caminho** (EM_ANDAMENTO), **Concluída**, **Cancelada**, **Recusada**, **Expirada**.
     - Tocar numa corrida em andamento abre o acompanhamento no mapa.
  4. **Pessoas:** "**N** pessoas ainda não fizeram corridas" (N1 e N2 ativos sem pedido nos últimos 90 dias) e "**N** convites não aceitos". O botão **"Reenviar convite"** usa o fluxo de convite que já existe (Equipe). O botão de lembrete por e-mail fica para a fase 5.
  5. **Exportar:** CSV do mês (data, quem pediu, roteiro, categoria, centro de custo e valor), para conferir a fatura por centro de custo.
- **Banco:** uma RPC de leitura `api.painel_empresa(p_empresa uuid default null, p_mes date default null)`. O N1 vê só a própria empresa; o ADM informa a empresa. Ela devolve os 4 blocos num JSON só, sem escrever nada.
- **Fora do escopo:** limite de gasto por pessoa ou por centro de custo, aprovação de corrida por gestor, e roteiro com paradas intermediárias (a Rhino mostra várias paradas, e o IVO tem origem e destino).

## 7. Segurança e privacidade

- **Os princípios de hoje continuam:**
  - toda regra fica no banco;
  - nenhuma UI otimista em dinheiro (aceitar, confirmar, sair);
  - o livro-razão é imutável;
  - a reconciliação diária continua.
- **A contraproposta** sai sempre do contrato (calculadora, §5.4). O ajuste livre continua limitado e auditado no banco, mas não é usado pela tela.
- **Localização:**
  - só durante a corrida, como na 3B. "Disponível para chamadas" **não** envia posição;
  - o aviso de LGPD da 3B continua antes da primeira viagem;
  - qualquer rastreio fora da corrida, no futuro, exige uma regra escrita e um aviso explícito ao motorista.
- **Termos do Google:**
  - do Google, o pedido guarda só o `place_id`. A linha da rota e os endereços formatados não são guardados;
  - nada de navegação curva a curva com a Routes API.
- **O centro de custo** é texto livre. Aparece só para quem vê o pedido e no extrato da empresa.
- **Endereço de teste:** usa o banco de produção. Isso é seguro porque os dados são de teste, mas **antes de entrar o primeiro cliente real** o dono precisa decidir se o endereço de teste continua apontando para produção (§12).

## 8. Testes

- **pgTAP:**
  - preço por categoria;
  - fallback dos contratos antigos para os campos atuais, provando que **nenhum preço em produção muda**;
  - ajuste dentro e fora do limite, e motivo obrigatório;
  - `centro_custo` gravado na aprovação;
  - veículos: só o dono ou o ADM editam; veículo em manutenção é recusado;
  - avaliação: uma vez, só por quem pode e só no concluído;
  - atraso automático marcando o próximo pedido;
  - guarda `0001_privilegios` verde.
- **Integração:**
  - o app atual (chamadas sem os campos novos) continua funcionando contra o banco novo. Teste de compatibilidade explícito;
  - concorrência de aceitar × cancelar.
- **Unidade:** estimativa por categoria na tela, decodificação da linha da rota, estado do mapa com nova tentativa e "última posição conhecida".
- **e2e (simulados):** pedir → chamada → propor valor → confirmar com centro de custo → sair → acompanhar → concluir → avaliar → pedir de novo. Também: cadastrar veículo; menu por perfil; claro e escuro; teclado e leitor de tela.
- **e2e contra o banco real (CI):** o mesmo fluxo de ponta a ponta, com o débito no extrato.
- **Roteiro no celular** para o dono (`fase-4-o-que-testar.md`), no endereço de teste, com dois aparelhos.

## 9. O que o dono precisa fazer (passo a passo na hora)

1. Aprovar o nome do endereço de teste.
2. Cadastrar o endereço novo no **Google Cloud** (referenciador da chave `navegador-mapa`), no **Supabase** (URL de retorno do Auth) e no **Cloudflare** (projeto do Pages e domínio do Turnstile).
3. Publicar no **contrato modelo** os preços de cada categoria (Painel do ADM › Contratos), quando a tela estiver pronta.
4. Ajuste de segurança pendente de 19/10: deixar a chave `navegador-mapa` **só com a Map Tiles API**.

## 10. App de loja (para depois): custo e opções

O PWA tem limites. Quando o motorista põe o Waze na frente ou apaga a tela, o envio da posição para (no iPhone, na hora). Também não há voz curva a curva dentro do app. Para resolver, é preciso um app de loja. Opções:

| Opção | Resolve | Custo |
|---|---|---|
| **App só do motorista, Android** (Capacitor ou Expo, reaproveitando as telas) | Rastreio em segundo plano com o Waze na frente | Google Play: US$ 25 uma vez, ou instalação direta sem loja no começo |
| **App do motorista, Android e iPhone** | O mesmo, nos dois sistemas | Apple: US$ 99 por ano, revisão de cada versão e justificativa de localização em segundo plano |
| **Navegação com voz dentro do app** | "Vire à direita" sem sair do IVO | Navigation SDK do Google: cobrado por viagem, só nativo |

Os clientes podem continuar no PWA em qualquer opção.

## 11. Ordem sugerida (o plano detalhado vem depois da aprovação)

1. **Banco:** categorias, preço por categoria (e as telas novas do ADM: Categorias e preços, Veículos) com fallback, veículos, ajuste, centro de custo, avaliação, atraso automático, `rota` com linha e pgTAP.
2. **Endereço de teste:** segundo site no Deploy e PWA próprio com aviso de nova versão.
3. **Cliente:** mapa inicial, categorias, agendar, confirmar, acompanhar e fim.
4. **Motorista:** chamada, aceitar ou propor, veículos, viagem com rota e corridas do mês.
5. **Menu** e o caminho para as telas do ADM.
6. **Revisão de segurança**, depois **um PR só** (o dono prefere fluxos completos).

O dono pode voltar atrás na decisão do repositório. Um repositório separado só para a interface nova também funciona, mas cada mudança no banco precisaria ser publicada antes, pelo repositório atual.

## 12. Riscos aceitos

- **Chamada só com o app aberto.** Sem push até a fase 5, o Ivo só ouve a chamada com o app aberto. Mitigação: a chamada fica nas Pendências e o prazo para responder é de horas (corridas agendadas).
- **Rastreio para com o Waze na frente** (limite do PWA, §10).
- **Endereço de teste no banco de produção.** Corridas de teste cobram do saldo, que hoje é de teste. Antes do primeiro cliente real, decidir entre manter isso ou apontar o teste para um banco separado.
- **Duas interfaces no mesmo banco** durante o teste. Cada mudança no banco precisa servir às duas, e o teste de compatibilidade da §8 cuida disso.
- **Preço proposto pelo motorista** pode surpreender o cliente. Mitigação: limite no banco, motivo obrigatório e o valor da tabela sempre ao lado.

## 13. Referências públicas

Padrões observados na Uber, InDrive, V1 e Rhinos e aplicados aqui:
- mapa como tela inicial;
- folha inferior com as categorias e o preço estimado;
- escolher para agora ou agendar;
- motorista "Disponível" num interruptor;
- chamada em tela cheia com prazo;
- contraproposta de valor (InDrive);
- acompanhamento com a chegada prevista grande;
- avaliação no fim;
- "Pedir de novo".

Só material público; nenhum código ou recurso desses apps é copiado.
