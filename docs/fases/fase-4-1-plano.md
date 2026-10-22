# Fase 4.1: plano de implementação (categorias livres, paradas e ajustes)

> **Para agentes:** sub-skill obrigatória: superpowers:subagent-driven-development (escolhida pelo dono) ou superpowers:executing-plans, tarefa por tarefa. Os passos usam caixas (`- [ ]`).

**Objetivo:** o app novo (ivo-novo.pages.dev) ganha:
- categorias criadas pelo Master, cada uma com tabela de preço própria, incluindo valor por hora e taxa por parada;
- pedidos com até 3 paradas;
- centro de custo ao pedir;
- navegação com volta ao início;
- painel da empresa com abas;
- a agenda ajustada.

**Arquitetura:**
- **Banco:** só acrescenta. Uma tabela de tarifas por categoria e versão de contrato, uma função de cálculo nova e paradas em tabela própria. O caminho de preço atual continua como fallback e para o app atual.
- **Front:** só em `src/novo` e `src/lib`.
- **Rota:** a função `enderecos` passa a aceitar pontos intermediários.

**Tecnologia:** Postgres/Supabase (pgTAP no CI), Edge Functions Deno, React 19, Vite, Leaflet, Playwright, Vitest.

**Especificação:** [`fase-4-1-categorias-paradas-desenho.md`](fase-4-1-categorias-paradas-desenho.md), aprovada em 22/10/2026, incluindo as decisões da §10. Mockups: [`../redesign/mockups-fase-4-1.html`](../redesign/mockups-fase-4-1.html).

Branch `fase-4-1` (a partir da `main` 9fee845) e **um PR só**; o merge é do dono. O repositório está público, então o CI é grátis. O banco só é verificado no CI: `git push origin HEAD:fase-4-1`, depois `gh run watch`. Não repita rodadas à toa.

## Restrições globais

- **Migrations:** só novas (`20261022…`); pgTAP novos a partir de `0041`. A guarda `0001_privilegios` fica verde.
- **RPCs:** `security definer set search_path = ''`, devolvem `{ok, codigo}`, negações por `interno.negar`, padrão `revoke all … grant execute … to authenticated`.
- **O app atual** (pedidos sem categoria, `publicar_contrato`, `enviar_orcamento` sem as chaves novas) continua igual.
- **Dinheiro:** em centavos; preço sempre do contrato; nenhuma UI otimista; total zero é recusado (`VALOR_INVALIDO`).
- **Termos do Google:** das paradas guarda só `place_id` ou o ponto marcado; a linha da rota não é gravada.
- **Tarifa:**
  - campos `taxa_fixa_cent`, `km_cent`, `hora_cent`, `hora_espera_cent`, `parada_cent`, `retorno_bp` (0–10000), `reboque_cent`, `hospedagem_diaria_cent`, todos ≥ 0;
  - **zerado = não cobra**;
  - `REBOQUE` só com a categoria marcada com reboque **e** `reboque_cent` > 0.
- **Limites:** até **3 paradas**. Horas estimadas de **0,5 a 24**, em passos de 0,5. Centro de custo com até **80** caracteres, opcional.
- **Categorias iniciais:**
  - `PASSAGEIROS`;
  - `CARGA_LEVE`, agora com reboque;
  - `MOTORISTA` (nova, `veiculo_cliente = true`, "Ivo dirige o carro da sua empresa");
  - `CARGA_PESADA` desativada.
- **Código da categoria:** gerado do nome, sem "IVO", sem acento, em maiúsculas, `_` no lugar de espaço; se repetir, ganha `_2`, `_3`…; imutável.
- **Texto da interface** (exato): "+ Adicionar parada"; "Horas estimadas"; "Centro de custo (opcional)"; "+ Nova categoria"; "Publicar tabela"; "← Início"; "Indisponível no momento"; rótulos "De", "Parada" e "Para".
- Português do Brasil; CSP sem estilos inline; acessível; claro e escuro.

## Foco da revisão

1. **Contrato publicado antes da 4.1** (sem tarifas): pedido por categoria pelo app novo e pelo app atual mantém exatamente o preço de hoje (Tarefa 1).
2. **Categoria criada depois da última publicação:** aparece "Indisponível no momento" e o `criar_pedido` dela é recusado com `CATEGORIA_INDISPONIVEL` (Tarefas 1 e 2).
3. **Quarta parada:** recusada no banco (`CAMPOS_INVALIDOS`, detalhe `paradas`) e o botão some na tela (Tarefas 2 e 6).
4. **IVO Motorista sem nenhum veículo cadastrado:** disponível se houver motorista ativo, e o veículo nunca é exigido no orçamento (Tarefa 2).
5. **Tela de 390 px com 3 paradas e a agenda aberta:** nada estoura nem rola de lado na página (Tarefas 6 e 10).

---

## Tarefas

| # | Tarefa | Verificação |
|---|---|---|
| 1 | Banco: categorias livres, tarifas, cálculo, publicar tarifas | pgTAP `0041` |
| 2 | Banco: paradas, horas, centro de custo ao pedir, disponibilidade e orçamento pela tarifa | pgTAP `0042` + integração |
| 3 | Rota com paradas (`enderecos`) e soma ida + volta | unidade |
| 4 | Bibliotecas do front (categorias e tarifas, paradas) | Vitest |
| 5 | Master: Categorias e preços (tarifas, nova categoria, publicar) e veículo com nomes do banco | e2e simulado |
| 6 | Cliente: pedir com paradas, horas e centro de custo, sem origem padrão | e2e simulado |
| 7 | Motorista: chamada e calculadora pela tarifa, viagem com paradas | e2e simulado |
| 8 | Navegação: cabeçalho "← Início", menu destacado, barra do cliente, De → Para | e2e simulado |
| 9 | Painel da empresa com abas, filtros e CSV | e2e simulado |
| 10 | Agenda: layout e rolagem lateral personalizada | e2e simulado |
| 11 | e2e contra o banco real (Motorista por hora; Passageiros com 2 paradas) | CI |
| 12 | Fechamento: roteiro, RUNBOOK, HANDOFF, PR | revisão |

---

### Tarefa 1: categorias livres, tarifas e cálculo

**Arquivos:** criar `supabase/migrations/20261022120000_categorias_tarifas.sql`; teste `supabase/tests/0041_categorias_tarifas.test.sql`.

**Interfaces:**
- **Muda em `app.categorias`:**
  - sai a CHECK dos três códigos;
  - entra `veiculo_cliente boolean not null default false`;
  - entra um índice único do nome entre as ativas;
  - `CARGA_LEVE.reboque = 'SIM'`;
  - `CARGA_PESADA.ativa = false`;
  - insere `MOTORISTA` (`IVO Motorista`, `Ivo dirige o carro da sua empresa`, carga PESSOAS, reboque NAO, `veiculo_cliente = true`, ordem 3).
- **Muda em `app.veiculos`:** sai a CHECK `categorias <@ array[...]`; um gatilho confere que cada código existe em `app.categorias` com `veiculo_cliente = false`.
- **Tabela nova** `app.tarifas_categoria(contrato_id bigint references app.contratos_versoes(id), categoria text references app.categorias(codigo), taxa_fixa_cent, km_cent, hora_cent, hora_espera_cent, parada_cent, reboque_cent, hospedagem_diaria_cent bigint ≥0, retorno_bp int 0..10000, primary key(contrato_id, categoria))`. É imutável, com o mesmo gatilho de `contratos_categorias`, e sem acesso direto.
- **Funções:**
  - `interno.codigo_categoria(p_nome text) returns text`, com a regra das restrições globais;
  - `interno.tarifa_da_categoria(c app.contratos_versoes, p_categoria text) returns app.tarifas_categoria` (null se a versão não tem tarifa dessa categoria);
  - `interno.tarifa_inicial(c app.contratos_versoes, p_categoria text) returns jsonb` (os valores de hoje, para preencher a tela):
    - km de `contratos_categorias` ou do contrato;
    - taxa fixa = `contratos_categorias.taxa_fixa_cent` (só Passageiros/Carga Leve; `reboque_cent` = `taxa_fixa_reboque_cent` quando a categoria tem reboque);
    - espera, hospedagem e retorno do contrato;
    - hora e parada 0;
  - `interno.linhas_da_tarifa(t app.tarifas_categoria, p_reboque boolean, p_levar bool, p_trazer bool, e jsonb) returns jsonb`:
    - entrada `km, horas, espera_horas, paradas, pedagio_cent, hospedagem_diarias, outros`;
    - linhas `TAXA_FIXA, KM, RETORNO, HORAS, ESPERA, PARADAS, REBOQUE, PEDAGIO, HOSPEDAGEM, OUTROS`, cada uma só se valor e quantidade forem > 0;
    - mesma forma de `interno.linha_orcamento`; mesmo teto de `calcular_linhas`;
    - total 0 → `{ok:false, codigo:'VALOR_INVALIDO'}`;
  - `interno.linhas_para_categoria(c, p_levar, p_trazer, p_categoria, e) returns jsonb`: usa `linhas_da_tarifa` se houver tarifa; senão `interno.linhas_da_categoria` (caminho atual).
- **Versões novas** (mesma assinatura): `api.categorias_disponiveis(p)`:
  - aceita também `paradas` (0–3) e `horas`;
  - lista as categorias ativas do banco;
  - `disponivel` = (veículo do cliente e motorista ativo) ou (veículo ativo do motorista que atende), **e** (a versão tem tarifa da categoria **ou** a categoria é uma das três antigas);
  - preço por `linhas_para_categoria`.
- **Versões novas de** `api.salvar_categoria(p)`:
  - sem `codigo` cria (devolve `{ok, codigo}`);
  - com `codigo` edita `nome`, `descricao_curta`, `ordem`, `ativa`, `veiculo_cliente`, `reboque`;
  - só `GERIR_CONTRATOS`.
- **Versões novas de** `api.categorias_adm(p_empresa, p_versao)`: cada categoria traz ainda `veiculo_cliente`, `reboque` e `tarifa` (a da versão, ou `interno.tarifa_inicial` com `inicial:true`).
- **Novas:**
  - `api.publicar_tarifas(p_empresa uuid, p_tarifas jsonb, p_vigente_desde timestamptz) returns jsonb`:
    - `p_tarifas` = `{CODIGO:{taxa_fixa_cent,…}}` com **todas as categorias ativas**;
    - cria a versão copiando os campos comuns da vigente (via `interno.inserir_contrato`);
    - grava as linhas;
    - devolve `{ok, versao}`;
    - `p_empresa` null = tabela modelo.
  - **`publicar_contrato` e `publicar_contrato_categorias`:** versões novas que copiam também as `tarifas_categoria` da versão anterior.

- [ ] **Passo 1: escrever o `0041`:**
  - `codigo_categoria('IVO Motorista')` = `'MOTORISTA'`; `'Ônibus Executivo'` → `'ONIBUS_EXECUTIVO'`; repetido → `_2`;
  - criar categoria; editar sem trocar código; N1 recusado (auditado);
  - `CARGA_PESADA` inativa e o pedido antigo com ela continua lido;
  - veículo com `MOTORISTA` é recusado; com um código inexistente, recusado;
  - **fallback:** sem tarifa, o total de Passageiros (km 42) é igual ao de antes da migration;
  - com tarifa (taxa 4000, km 350, parada 1500, retorno 2000 bp), km 48 e 1 parada dá as linhas TAXA_FIXA 4000, KM 16800, RETORNO 3360, PARADAS 1500;
  - MOTORISTA com `hora_cent` 9000 e horas 4 → HORAS 36000, sem KM;
  - Carga Leve com reboque e `reboque_cent` 2500 → REBOQUE; a mesma tarifa numa categoria sem reboque → sem REBOQUE;
  - tarifa toda zerada → `VALOR_INVALIDO`;
  - `publicar_tarifas` sem uma categoria ativa → `CAMPOS_INVALIDOS`; copia prazos e faixas da vigente; N1 recusado;
  - `publicar_contrato` depois de `publicar_tarifas` mantém as tarifas;
  - categoria nova sem tarifa → `disponivel:false` em `categorias_disponiveis`;
  - `categorias_adm` sem versão traz `tarifa` com `inicial:true` e os valores de hoje.
- [ ] **Passo 2:** push; o CI falha no `0041`. **Passo 3:** migration. **Passo 4:** push; o CI fica verde.
- [ ] **Passo 5:** commit `feat(fase 4.1): categorias livres com tabela de preço própria`.

### Tarefa 2: paradas, horas e centro de custo no pedido

**Arquivos:** criar `supabase/migrations/20261022120100_paradas_pedido.sql`; testes `supabase/tests/0042_paradas_pedido.test.sql` e `tests/integracao/paradas.test.ts`.

**Interfaces:**
- **Consome:** Tarefa 1.
- **Tabela nova** `app.atividades_paradas(atividade_id uuid references app.atividades, ordem smallint 1..3, texto text 3..200, place_id text null, lat numeric(9,6) null, lng numeric(9,6) null, primary key(atividade_id, ordem))`:
  - check: `place_id` ou o par lat/lng, nunca os dois;
  - sem acesso direto.
- **Coluna nova** `app.atividades.horas_estimadas numeric(4,1) null check (horas_estimadas between 0.5 and 24 and horas_estimadas*2 = trunc(horas_estimadas*2))`.
- **Versões novas** (mesma assinatura):
  - `interno.validar_pedido`: aceita `paradas` (lista de até 3 de `{texto, place_id}` ou `{texto, lat, lng}`), `horas_estimadas` e `centro_custo` (≤80). Quando a tarifa da categoria tem `hora_cent` > 0, `horas_estimadas` é obrigatório;
  - `api.criar_pedido`: grava paradas, horas e centro de custo; a categoria com `veiculo_cliente` grava `modalidade='VEICULO_CLIENTE'` e dispensa o veículo;
  - `api.calcular_orcamento` / `api.enviar_orcamento`:
    - usam `interno.linhas_para_categoria`;
    - aceitam na entrada `horas` e `paradas` (só com tarifa);
    - `veiculo_id` não é exigido para categoria `veiculo_cliente`;
  - `api.confirmar_corrida`: se `p_centro_custo` vier (não nulo), **substitui** o gravado;
  - `api.pedido`: devolve `paradas[]` (texto, place_id, lat, lng, na ordem), `horas_estimadas` e `centro_custo`;
  - `api.painel_empresa`: cada pedido traz `paradas` (textos);
  - `api.pendencias`: nada muda.

- [ ] **Passo 1: escrever o `0042`:**
  - pedido com 2 paradas grava na ordem; 4 → `CAMPOS_INVALIDOS`; parada com `place_id` e lat ao mesmo tempo → recusada;
  - MOTORISTA sem `horas_estimadas` → `CAMPOS_INVALIDOS`; com 4 → ok, sem veículo cadastrado;
  - `centro_custo` gravado ao pedir; `confirmar_corrida` com outro valor troca; com null mantém;
  - `enviar_orcamento` de MOTORISTA com `{horas:4}` → total 36000 e sem `veiculo_id`;
  - `api.pedido` traz as paradas para o N2 dono e para o motorista.
- [ ] **Passo 2:** integração em `paradas.test.ts`: o app atual (corpo de `montarPedido`) continua criando e orçando igual.
- [ ] **Passo 3:** push vermelho → migration → push verde.
- [ ] **Passo 4:** commit `feat(fase 4.1): paradas, horas estimadas e centro de custo ao pedir`.

### Tarefa 3: rota com paradas

**Arquivos:**
- Modificar: `supabase/functions/enderecos/google.ts` (ação `rota`) e `src/lib/enderecosRemoto.ts`, `src/lib/rotaDesenhada.ts`.
- Teste: `supabase/functions/enderecos/enderecos.test.ts` e `src/lib/rotaDesenhada.test.ts`.

**Interfaces:**
- **Ação `rota`:** aceita `paradas?: PontoRota[]` (no máximo 3, senão `ENTRADA_INVALIDA`), enviadas como `intermediates` no `computeRoutes`. Devolve `{ok, km, minutos, polyline}` do trajeto inteiro.
- **`rotaAte`:** `rotaAte(origem, destino, paradas?: PontoRota[])` → mesmo retorno.
- **Nova** `kmDoPedido({ida: {km}, volta?: {km}|null, levar, trazer}) => number|null`: só ida → km da ida; ida e volta → ida (com paradas) + volta direta; arredondado com `kmDaRota`.

- [ ] **Passo 1:** testes:
  - a máscara do Google inclui `intermediates` com 2 paradas;
  - 4 paradas → `ENTRADA_INVALIDA`;
  - `kmDoPedido({ida:{km:48.2}, volta:{km:41.0}, levar:true, trazer:true})` = 89.2;
  - só ida = 48.2.
- [ ] **Passo 2:** vermelho → implementar → verde (local).
- [ ] **Passo 3:** commit `feat(fase 4.1): rota com paradas e km de ida e volta`.

### Tarefa 4: bibliotecas do front

**Arquivos:**
- Modificar: `src/lib/categorias.ts`, `src/lib/categoriasAdm.ts`, `src/lib/veiculos.ts`.
- Criar: `src/lib/tarifas.ts`, `src/lib/paradas.ts`.
- Testes ao lado de cada arquivo.

**Interfaces:**
- `categorias.disponiveis({km, levar, trazer, paradas, horas})`. Cada categoria traz também `veiculo_cliente`, `cobra_hora: boolean` e `cobra_parada: boolean` (derivados da tarifa no servidor; acrescentar ao retorno da Tarefa 1 se faltar).
- `pedidoDaCategoria(c, base, {agora, paradas, horas, centroCusto})`: o payload de `criar_pedido`.
- `tarifas`:
  - `type Tarifa = {taxa_fixa_cent, km_cent, hora_cent, hora_espera_cent, parada_cent, retorno_bp, reboque_cent, hospedagem_diaria_cent}`;
  - `paraFormulario(t)` / `doFormulario(f) => Tarifa|{erro}` (reais com vírgula → centavos; % → bp);
  - `diferencas(antes, depois) => string[]` para a revisão;
  - `categoriasAdm.publicarTarifas(empresa, tarifas, vigenteDesde)`;
  - `categoriasAdm.salvar(p)`.
- `paradas`: `type Parada = {texto, place_id?} | {texto, lat, lng}`; `MAX_PARADAS = 3`; `adicionar`, `remover(i)`.
- `veiculos`: **apagar** `NOMES_CATEGORIA` fixo; nomes vêm de `categoriasAdm.listar()` / `categorias_disponiveis`.

- [ ] **Passo 1:** testes:
  - `doFormulario({km:'3,50', retorno:'20'})` → `km_cent 350`, `retorno_bp 2000`;
  - valor negativo → erro;
  - `diferencas` lista "Por km: R$ 3,50 → R$ 3,80";
  - `adicionar` além de 3 não altera a lista;
  - `pedidoDaCategoria` de MOTORISTA leva `horas_estimadas` e `modalidade` `VEICULO_CLIENTE`.
- [ ] **Passo 2:** vermelho → verde. **Passo 3:** commit `feat(fase 4.1): bibliotecas de tarifas, paradas e categorias do banco`.

### Tarefa 5: Master — Categorias e preços, e veículo com nomes do banco

**Arquivos:** modificar `src/novo/telas/adm/CategoriasPrecos.tsx`, `src/novo/telas/motorista/CadastrarVeiculo.tsx`, `src/novo/telas/motorista/MeusVeiculos.tsx`; teste `tests/e2e/novo-categorias-tarifas.spec.ts`.

- [ ] **Passo 1: e2e** (mockup 5):
  - cada categoria em cartão com os 8 campos ("deixe zerado se não cobra"); o campo Reboque só aparece em categoria com reboque;
  - a primeira abertura vem preenchida (`inicial:true`);
  - "+ Nova categoria" cria um cartão; salvar envia `salvar_categoria` sem código;
  - "Publicar tabela" mostra a revisão com as diferenças e chama `publicar_tarifas` com **todas** as ativas;
  - o cadastro de veículo mostra "IVO Passageiros" e "IVO Carga Leve" com os nomes do banco (renomear muda o rótulo) e **não** mostra MOTORISTA nem inativas;
  - N1 não acessa.
- [ ] **Passo 2:** vermelho → implementar → verde.
- [ ] **Passo 3:** commit `feat(fase 4.1): categorias e preços por categoria e veículo com nomes do banco`.

### Tarefa 6: Cliente — pedir com paradas, horas e centro de custo

**Arquivos:** modificar `src/novo/telas/cliente/InicioCliente.tsx`, `EscolherCategoria.tsx`, `ConfirmarCorrida.tsx`; teste `tests/e2e/novo-pedir-paradas.spec.ts`.

- [ ] **Passo 1: e2e** (mockups 1 e 2):
  - origem **vazia** ao abrir (nenhuma chamada preenche);
  - "+ Adicionar parada" até 3, depois o botão some; × remove;
  - o mapa recebe a rota com paradas (`rota` com `paradas`);
  - preço pedido com `paradas:1`;
  - MOTORISTA mostra "Horas estimadas" com − / +, e o preço é pedido com `horas`;
  - "Centro de custo (opcional)" acima do botão, com o último usado; o valor vai em `criar_pedido`;
  - a confirmação mostra o centro de custo do pedido, editável;
  - 390 px com 3 paradas sem rolagem lateral.
- [ ] **Passo 2:** vermelho → verde.
- [ ] **Passo 3:** commit `feat(fase 4.1): pedir com paradas, horas e centro de custo`.

### Tarefa 7: Motorista — tarifa, paradas e viagem

**Arquivos:** modificar `src/novo/telas/motorista/Chamada.tsx`, `ProporValor.tsx`, `chamada.ts`, `ViagemNoMapa.tsx`; teste `tests/e2e/novo-motorista-tarifa.spec.ts`.

- [ ] **Passo 1: e2e:**
  - a calculadora só mostra os itens com preço > 0 na tarifa (MOTORISTA: Horas, Hospedagem, Pedágio, Outros; sem Km);
  - a chamada de MOTORISTA não pede veículo;
  - a contraproposta com horas envia `{horas}`;
  - a viagem desenha origem → paradas → destino;
  - "Abrir no Waze" vai para a **próxima** parada não passada (a 150 m conta como passada).
- [ ] **Passo 2:** vermelho → verde.
- [ ] **Passo 3:** commit `feat(fase 4.1): calculadora pela tarifa e viagem com paradas`.

### Tarefa 8: navegação e De → Para

**Arquivos:**
- Modificar: `src/novo/MolduraNova.tsx` (`TelaDePagina` ganha cabeçalho), `src/novo/componentes/Menu.tsx` (item atual destacado).
- Criar: `src/novo/componentes/BarraCliente.tsx` e um componente `RotaDePara` usado nas listas.
- Teste: `tests/e2e/novo-navegacao.spec.ts`.

- [ ] **Passo 1: e2e** (mockup 4):
  - toda rota de `TelaDePagina` tem "← Início", que leva a `/` (cliente: tela de pedir; motorista: Início dele), e o título;
  - o menu marca a página atual (`aria-current`);
  - no celular do cliente, a barra Pedir · Corridas · Agenda · Carteira fica fixa e alterna sem recarregar;
  - as listas de corridas mostram "De", "Parada" e "Para" nessa ordem.
- [ ] **Passo 2:** vermelho → verde.
- [ ] **Passo 3:** commit `feat(fase 4.1): navegação com volta ao início e De → Para`.

### Tarefa 9: Painel da empresa com abas

**Arquivos:**
- Modificar: `src/novo/telas/empresa/PainelEmpresa.tsx` e `src/novo/rotas.tsx` (rotas `/empresa`, `/empresa/corridas`, `/empresa/pessoas`, `/empresa/carteira` sob o mesmo layout).
- Criar: `src/novo/telas/empresa/AbaCorridas.tsx`, `AbaPessoas.tsx`, `AbaCarteira.tsx`.
- Teste: `tests/e2e/novo-painel-abas.spec.ts`.

- [ ] **Passo 1: e2e** (mockup 6):
  - as abas trocam o conteúdo mantendo cabeçalho e seletor de empresa (o Master troca a empresa e continua na aba);
  - Corridas: filtros mês, status e centro de custo; CSV com as colunas "Data;Quem pediu;De;Paradas;Para;Categoria;Horas;Centro de custo;Valor";
  - Pessoas reaproveita a Equipe; Carteira, o saldo e o extrato;
  - tom executivo (R17 da fase 4).
- [ ] **Passo 2:** vermelho → verde.
- [ ] **Passo 3:** commit `feat(fase 4.1): painel da empresa com abas`.

### Tarefa 10: agenda e rolagem lateral

**Arquivos:**
- Modificar: `src/novo/telas/cliente/EscolherCategoria.tsx` (`EscolherHorario`) e `src/design/estilos.css` (classe `rolagem-ivo`, sem afetar o app atual).
- Teste: `tests/e2e/novo-agenda.spec.ts`.

- [ ] **Passo 1: e2e** (mockup 3):
  - a faixa de dias usa `rolagem-ivo`: barra fina com as cores do token, `scroll-snap` por dia;
  - no computador, setas ‹ › avançam um bloco;
  - os horários ficam agrupados em Manhã, Tarde e Noite, em 4 colunas;
  - a folha não passa da altura da tela a 390 × 844;
  - com movimento reduzido, a rolagem não anima.
- [ ] **Passo 2:** vermelho → verde.
- [ ] **Passo 3:** commit `feat(fase 4.1): agenda ajustada com rolagem lateral personalizada`.

### Tarefa 11: e2e contra o banco real

**Arquivos:** criar `tests/e2e/real/fase-4-1.spec.ts` (projeto `real`, 1 worker; padrão de `real/estilo-uber.spec.ts`).

- [ ] **Passo 1: fluxo A:**
  - o Master publica tarifas (Passageiros com taxa por parada; MOTORISTA com hora);
  - o N2 pede MOTORISTA com 4 horas e centro de custo;
  - o motorista aceita (sem veículo);
  - o N2 confirma, há saída e conclusão;
  - o extrato tem 1 DEBITO = 4 × hora + linhas aplicáveis, com o centro de custo.
- [ ] **Passo 2: fluxo B:** o N2 pede Passageiros com 2 paradas; o DEBITO inclui o km total e 2 × taxa por parada.
- [ ] **Passo 3:** push; o CI fica verde. Commit `test(fase 4.1): e2e real de categoria por hora e corrida com paradas`.

### Tarefa 12: fechamento

- [ ] `docs/fases/fase-4-1-o-que-testar.md`: roteiro no celular cobrindo o §1 da especificação.
- [ ] RUNBOOK §18 com a seção "Categorias e preços (4.1)": publicar a tabela; zerado = não cobra; categoria nova fica indisponível até publicar; paradas; IVO Motorista por hora.
- [ ] Atualizar o HANDOFF e abrir **um PR** para a `main` com o checklist do dono (publicar a tabela de cada categoria). O merge é do dono.

## Autorrevisão (feita)

- **Cobertura da especificação:**

  | Seção da especificação | Tarefas |
  |---|---|
  | §1.1 | 1 e 5 |
  | §1.2 | 1, 2, 6 e 7 |
  | §1.3 | 2, 3, 6 e 7 |
  | §1.4 | 2 e 6 |
  | §1.5 | 4 e 5 |
  | §1.6 | 10 |
  | §1.7 | 9 |
  | §1.8 | 8 |
  | §1.9 | 8 e 9 |
  | §1.10 | 6 |
  | §10 | 1, 2, 4, 5 e 9 |

- **Nomes conferidos:**
  - `linhas_da_tarifa` / `linhas_para_categoria` / `tarifa_inicial` / `publicar_tarifas`;
  - `atividades_paradas` / `horas_estimadas`;
  - `rotaAte(…, paradas)` / `kmDoPedido`;
  - `Tarifa` / `MAX_PARADAS`.
