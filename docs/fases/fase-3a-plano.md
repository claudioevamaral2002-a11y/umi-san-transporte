# Fase 3A: plano de implementação (endereços reais, distância e prévia)

> **Para agentes:** sub-skill obrigatória: `superpowers:subagent-driven-development` (recomendada) ou `superpowers:executing-plans`. Os passos usam caixas `- [ ]`.

**Objetivo:**
- o cliente escolhe a origem e o destino entre endereços reais (ou marca o ponto no mapa) e vê os km da rota;
- em "Confira o pedido", N1 e N2 veem a prévia do orçamento pela tabela do contrato;
- o motorista recebe os km preenchidos no "Orçar".

**Arquitetura:**
- **Edge Function nova `enderecos`:** guarda a chave de servidor do Google e chama Places (New) e Routes. Antes de cada chamada ao Google, ela registra o uso numa RPC com o JWT do usuário (limite por usuário e teto diário por empresa, no banco).
- **Banco:** ganha as colunas de coordenadas e km no pedido, a tabela `app.locais_empresa` e as RPCs `locais_da_empresa`, `previa_orcamento` e `registrar_uso_mapas`. A prévia reaproveita `interno.calcular_linhas`.
- **Front:** um campo de endereço com lista (listbox), uma folha "Marcar no mapa" (Leaflet carregado sob demanda, com blocos da Google Map Tiles API) e a prévia em "Confira o pedido".

**Stack:**
- Supabase Postgres, com pgTAP;
- Edge Functions em Deno, testadas no Vitest por injeção de `fetch`;
- React 19 e Tailwind 4;
- Leaflet 1.9.4;
- Playwright (projetos `celular` e `iphone`).

**Especificação:** `docs/fases/fase-3a-desenho-enderecos-previa.md`. Mockups aprovados: `docs/redesign/mockups-fase-3a.html`.

## Restrições globais

- Regras de ouro do `HANDOFF.md`:
  - toda regra fica no banco;
  - as RPCs são `SECURITY DEFINER`, com `set search_path = ''`, e devolvem `{ok, codigo}`;
  - negações são auditadas por `interno.negar`;
  - dinheiro é sempre em centavos;
  - **migrations: só criar novas.**
- A guarda pgTAP `0001_privilegios` precisa continuar verde:
  - tabelas novas em `app`, com RLS e sem grant de escrita;
  - funções `interno.*` revogadas de `public, anon, authenticated`;
  - funções `api.*` revogadas de `public, anon, authenticated, service_role` e depois liberadas com `grant execute ... to authenticated`.
- A chave de servidor do Google (`GOOGLE_MAPS_CHAVE_SERVIDOR`) existe só como segredo da função. A chave de navegador (`VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR`) é restrita ao domínio do app e só à Map Tiles API.
- **CSP:** o único acréscimo permitido é `https://tile.googleapis.com` em `img-src` e `connect-src`. Nenhum `script-src` novo e nada de `unsafe-inline`.
- **Bundle inicial ≤ 150 KB gzip:** o Leaflet entra só por `import()` dinâmico.
- **Prévia:**
  - só para cliente N1 e N2, e nunca grava orçamento;
  - usa `interno.contrato_vigente(empresa)` (o contrato vigente agora), a mesma regra de `api.calcular_orcamento`, para a prévia bater com o orçamento do motorista.
- **Google:**
  - autocompletar com `sessionToken` (UUIDv4 por sessão), `includedRegionCodes: ["br"]` e `languageCode: "pt-BR"`;
  - detalhe com `X-Goog-FieldMask: id,formattedAddress,location` (faixa Essentials);
  - rota com `X-Goog-FieldMask: routes.distanceMeters,routes.duration`.
- **Limites:**
  - por usuário: 60 sugestões e 20 rotas por minuto;
  - por empresa: 2.000 chamadas ao Google por dia, configurável em `app.configuracoes` pela chave `mapas_teto_diario_empresa`.
- **Textos:** pt-BR e voz ativa. Sem " · " e sem "→" (a guarda `scripts/varrer-estilo.ts` falha).
- **Testes de toque:** Pixel e iPhone, nos modos claro e escuro, para as telas novas.

## Foco de revisão

1. **Sessão abandonada:** a pessoa digita, apaga e fecha a lista sem escolher. A próxima busca precisa usar um **token novo**, porque reaproveitar token faz o Google cobrar cada chamada → teste de unidade em `enderecos.test.ts` (Tarefa 6).
2. **Corrida de respostas:** a sugestão de "estal" chega depois da de "estaleiro". A lista mostra só a resposta da última digitação → teste de unidade (Tarefa 6) e e2e com atraso (Tarefa 8).
3. **Origem e destino no mesmo ponto, ou sem rota de carro** (ilha): a prévia não aparece e o pedido segue normalmente → teste e2e (Tarefa 10) e teste da função (Tarefa 5).
4. **Pedido antigo, sem coordenadas, aberto no "Orçar":** os km continuam vazios e nada quebra → teste e2e (Tarefa 11).
5. **Conta trocada no mesmo aparelho:** os locais da empresa A não aparecem para a empresa B. A busca de locais passa pelo banco e nunca pela memória das consultas → teste pgTAP (Tarefa 2) e regra "sem `cache`" no hook (Tarefa 8).

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261015120000_mapas_enderecos.sql` (novo) | Colunas do pedido, `validar_pedido`, `criar_pedido`, `pedido` com os campos novos |
| `supabase/migrations/20261015120100_locais_empresa.sql` (novo) | `app.locais_empresa`, gravação no `criar_pedido` e `api.locais_da_empresa` |
| `supabase/migrations/20261015120200_previa_orcamento.sql` (novo) | `api.previa_orcamento` e a ação `PREVIA_ORCAMENTO` em `app.pode_fazer` |
| `supabase/migrations/20261015120300_uso_mapas.sql` (novo) | `app.uso_mapas`, a configuração do teto e `api.registrar_uso_mapas` |
| `supabase/tests/0021_mapas_pedido.test.sql` … `0024_uso_mapas.test.sql` (novos) | pgTAP de cada migration |
| `supabase/functions/enderecos/index.ts`, `enderecos/google.ts`, `enderecos/enderecos.test.ts` (novos) | Função, cliente do Google e testes |
| `supabase/config.toml`, `.github/workflows/ci.yml`, `deploy.yml` (mod.) | `verify_jwt = false` e o segredo nos ambientes |
| `src/lib/enderecos.ts` + `.test.ts` (novo) | Chamadas à função, token de sessão, última resposta vence, formatação |
| `scripts/gerar-headers.ts` + `.test.ts` (mod.) | CSP com `tile.googleapis.com` |
| `src/telas/pedidos/CampoEndereco.tsx` (novo) | Campo com lista de sugestões (listbox) |
| `src/telas/pedidos/FolhaMarcarNoMapa.tsx`, `src/lib/mapaTiles.ts` (novos) | Folha com Leaflet e blocos do Google |
| `src/lib/novoPedido.ts`, `src/telas/pedidos/NovoPedido.tsx` (mod.) | Campos novos do formulário, rota no "Onde?" e prévia no "Confira" |
| `src/telas/pedidos/PreviaOrcamento.tsx` (novo) | Bloco da prévia |
| `src/lib/orcar.ts`, `src/telas/pedidos/Orcar.tsx` (mod.) | km preenchidos pela rota |
| `tests/e2e/enderecos.spec.ts`, `tests/e2e/toque-enderecos.spec.ts`, `tests/e2e/apoio/mapasFalsos.ts` (novos) | E2E com o Google simulado |
| `tests/integracao/mapas.test.ts` (novo) | Prévia = orçamento, contra o banco real |
| `docs/fases/fase-3a-o-que-testar.md`, `docs/RUNBOOK.md` §Google (novo/mod.) | Roteiro do dono e configuração do Google |

---

### Tarefa 1: colunas do pedido e campos novos no `criar_pedido`

**Arquivos:** criar `supabase/migrations/20261015120000_mapas_enderecos.sql` e `supabase/tests/0021_mapas_pedido.test.sql`.

**Interfaces:**
- **Produz:**
  - colunas em `app.atividades`: `origem_lat numeric(9,6)`, `origem_lng numeric(9,6)`, `destino_lat numeric(9,6)`, `destino_lng numeric(9,6)`, `origem_endereco text`, `destino_endereco text`, `origem_place_id text`, `destino_place_id text`, `km_estimado numeric(7,1)`, `minutos_estimados int`;
  - chaves opcionais aceitas por `api.criar_pedido(p jsonb)`: `origem_lat`, `origem_lng`, `destino_lat`, `destino_lng`, `origem_endereco`, `destino_endereco`, `origem_place_id`, `destino_place_id`, `km_estimado`, `minutos_estimados`;
  - `api.pedido(p_id)` devolve esses campos dentro de `pedido`.

- [ ] **Passo 1: teste pgTAP que falha.** Em `0021_mapas_pedido.test.sql`, copie o cabeçalho de `0020_credito_criar_pedido.test.sql` (empresa, N2, contrato `t.base`, claims). Depois:
```sql
select plan(7);
-- (cabeçalho copiado de 0020: empresa ...e1, N2 ...a5 com contrato vigente e saldo)
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select set_config('t.pedido', json_build_object(
  'inicio', (now() + interval '3 days')::text, 'duracao_min', 120, 'origem', 'Porto de Itajaí', 'destino', 'Estaleiro Navegantes',
  'levar', true, 'trazer', false, 'carga', 'PESSOAS', 'modalidade', 'VEICULO_PROPRIO', 'reboque', 'NAO', 'pessoas_qtd', 2)::text, true);
select is(api.criar_pedido(current_setting('t.pedido')::jsonb) ->> 'ok', 'true', 'pedido sem coordenadas continua válido');
select is(api.criar_pedido(current_setting('t.pedido')::jsonb || jsonb_build_object(
  'inicio', (now() + interval '4 days')::text,
  'origem_lat', -26.9078, 'origem_lng', -48.6619, 'destino_lat', -26.8986, 'destino_lng', -48.6542,
  'origem_endereco', 'Av. Min. Victor Konder, Itajaí', 'destino_endereco', 'Av. Pref. Cirino Adolfo Cabral, 1500',
  'origem_place_id', 'ChIJabc', 'destino_place_id', 'ChIJdef', 'km_estimado', 38.2, 'minutos_estimados', 45)) ->> 'ok', 'true',
  'pedido com coordenadas e km estimado');
reset role;
select is((select km_estimado from app.atividades where origem_place_id = 'ChIJabc'), 38.2::numeric, 'km gravado');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.criar_pedido(current_setting('t.pedido')::jsonb || '{"origem_lat": 120}'::jsonb) ->> 'codigo', 'CAMPOS_INVALIDOS', 'latitude fora de -90..90');
select is(api.criar_pedido(current_setting('t.pedido')::jsonb || '{"km_estimado": 9000}'::jsonb) ->> 'codigo', 'CAMPOS_INVALIDOS', 'km acima de 5000');
select is(api.criar_pedido(current_setting('t.pedido')::jsonb || '{"origem_lat": -26.9}'::jsonb) ->> 'codigo', 'CAMPOS_INVALIDOS', 'latitude sem longitude');
select is(api.criar_pedido(current_setting('t.pedido')::jsonb || '{"origem_place_id": "x y/../"}'::jsonb) ->> 'codigo', 'CAMPOS_INVALIDOS', 'place_id com caracteres inválidos');
select * from finish(); rollback;
```

- [ ] **Passo 2: ver falhar.** Sem Docker local, o banco só roda no CI. Faça commit numa branch, dê push e confira o run (`gh run watch <id>`). Esperado: FAIL no segundo teste, com `CAMPOS_INVALIDOS` para as chaves desconhecidas.

- [ ] **Passo 3: migration.** Em `20261015120000_mapas_enderecos.sql`:
```sql
-- Fase 3A (decisão do dono, 2026-10-14): endereços reais, distância e prévia.
--   Coordenadas, endereço formatado, place_id e km/minutos estimados pela rota (Google), todos opcionais:
--   pedidos antigos e pedidos sem endereço reconhecido continuam válidos.
------------------------------------------------------------------------------------------------------------------------
-- 1. Colunas.
------------------------------------------------------------------------------------------------------------------------
alter table app.atividades
  add column origem_lat numeric(9,6), add column origem_lng numeric(9,6),
  add column destino_lat numeric(9,6), add column destino_lng numeric(9,6),
  add column origem_endereco text, add column destino_endereco text,
  add column origem_place_id text, add column destino_place_id text,
  add column km_estimado numeric(7,1), add column minutos_estimados int,
  add constraint atividades_origem_coord check ((origem_lat is null) = (origem_lng is null)),
  add constraint atividades_destino_coord check ((destino_lat is null) = (destino_lng is null)),
  add constraint atividades_lat check (origem_lat between -90 and 90 and destino_lat between -90 and 90),
  add constraint atividades_lng check (origem_lng between -180 and 180 and destino_lng between -180 and 180),
  add constraint atividades_km_est check (km_estimado between 0 and 5000),
  add constraint atividades_min_est check (minutos_estimados between 0 and 10000),
  add constraint atividades_enderecos check (char_length(origem_endereco) <= 300 and char_length(destino_endereco) <= 300),
  add constraint atividades_place check (origem_place_id ~ '^[A-Za-z0-9_-]{1,300}$' and destino_place_id ~ '^[A-Za-z0-9_-]{1,300}$');
```
A seção 2 recria `interno.validar_pedido`: copie o corpo atual de `20261009130000_pedidos_agenda.sql:261` com `create or replace` e acrescente ao array `opcionais`:
```sql
'origem_lat','origem_lng','destino_lat','destino_lng','origem_endereco','destino_endereco',
'origem_place_id','destino_place_id','km_estimado','minutos_estimados'
```
Acrescente também estas checagens antes do `return true`:
```sql
  -- Coordenadas vêm em par; números dentro dos limites; place_id só com caracteres do Google.
  if (p ? 'origem_lat') <> (p ? 'origem_lng') or (p ? 'destino_lat') <> (p ? 'destino_lng') then return false; end if;
  if p ? 'origem_lat' and (jsonb_typeof(p->'origem_lat') <> 'number' or (p->>'origem_lat')::numeric not between -90 and 90
     or jsonb_typeof(p->'origem_lng') <> 'number' or (p->>'origem_lng')::numeric not between -180 and 180) then return false; end if;
  if p ? 'destino_lat' and (jsonb_typeof(p->'destino_lat') <> 'number' or (p->>'destino_lat')::numeric not between -90 and 90
     or jsonb_typeof(p->'destino_lng') <> 'number' or (p->>'destino_lng')::numeric not between -180 and 180) then return false; end if;
  if p ? 'km_estimado' and (jsonb_typeof(p->'km_estimado') <> 'number' or (p->>'km_estimado')::numeric not between 0 and 5000) then return false; end if;
  if p ? 'minutos_estimados' and (jsonb_typeof(p->'minutos_estimados') <> 'number' or (p->>'minutos_estimados')::numeric not between 0 and 10000) then return false; end if;
  if (p ? 'origem_place_id' and coalesce(p->>'origem_place_id','') !~ '^[A-Za-z0-9_-]{1,300}$')
     or (p ? 'destino_place_id' and coalesce(p->>'destino_place_id','') !~ '^[A-Za-z0-9_-]{1,300}$') then return false; end if;
  if char_length(coalesce(p->>'origem_endereco','')) > 300 or char_length(coalesce(p->>'destino_endereco','')) > 300 then return false; end if;
```
A seção 3 recria `api.criar_pedido`: copie o corpo de `20261013120000_credito_ao_criar_pedido.sql:10`, com `create or replace`, e acrescente ao `insert into app.atividades (...)` as colunas e os valores:
```sql
  origem_lat, origem_lng, destino_lat, destino_lng, origem_endereco, destino_endereco,
  origem_place_id, destino_place_id, km_estimado, minutos_estimados
  ...
  (p->>'origem_lat')::numeric, (p->>'origem_lng')::numeric, (p->>'destino_lat')::numeric, (p->>'destino_lng')::numeric,
  nullif(p->>'origem_endereco',''), nullif(p->>'destino_endereco',''),
  p->>'origem_place_id', p->>'destino_place_id', (p->>'km_estimado')::numeric, (p->>'minutos_estimados')::int
```
A seção 4 recria `api.pedido`: copie a última definição (localize com `grep -n "function api.pedido(" supabase/migrations/*.sql | tail -1`) e acrescente ao `jsonb_build_object` do pedido as dez chaves novas, com os mesmos nomes. Como `create or replace` mantém os grants, nada muda em grants.

- [ ] **Passo 4: ver passar.** Faça push e acompanhe o CI. Esperado: `0021` com 7/7 verde e `0001_privilegios` verde.

- [ ] **Passo 5: commit.** Mensagem: `feat(fase 3A): coordenadas, endereço e km estimado no pedido`.

---

### Tarefa 2: locais da empresa

**Arquivos:** criar `supabase/migrations/20261015120100_locais_empresa.sql` e `supabase/tests/0022_locais_empresa.test.sql`.

**Interfaces:**
- **Consome:** as colunas da Tarefa 1.
- **Produz:**
  - `api.locais_da_empresa(p_texto text) returns jsonb` devolve `{ok:true, locais:[{nome, endereco, lat, lng, place_id}]}`, no máximo 5, só da empresa de quem chama. Liberada para cliente N1, N2 e N3.
  - `api.criar_pedido` passa a gravar ou atualizar os dois locais.

- [ ] **Passo 1: teste pgTAP que falha** (`0022`). Use duas empresas, A (`...e1`) e B (`...e2`), cada uma com um N2 e um contrato.
```sql
select plan(6);
-- N2 de A cria um pedido com destino 'Estaleiro Navegantes' (place_id 'ChIJdef'), duas vezes.
select is((api.locais_da_empresa('estal') -> 'locais' -> 0 ->> 'nome'), 'Estaleiro Navegantes', 'A encontra o local pelo nome, sem acento e sem caixa');
select is((api.locais_da_empresa('estal') -> 'locais' -> 0 ->> 'place_id'), 'ChIJdef', 'devolve o place_id');
select is(jsonb_array_length(api.locais_da_empresa('') -> 'locais'), 2, 'texto vazio: os mais usados (origem e destino)');
-- Troca para o N2 de B.
select is(jsonb_array_length(api.locais_da_empresa('estal') -> 'locais'), 0, 'B não vê locais de A');
select is(api.locais_da_empresa(repeat('x', 121)) ->> 'codigo', 'CAMPOS_INVALIDOS', 'texto acima de 120');
reset role;
select throws_ok($$ set local role authenticated; insert into app.locais_empresa (empresa_id, nome, lat, lng) values ('00000000-0000-0000-0000-0000000000e1','x',0,0) $$, '42501', null, 'sem escrita direta');
select * from finish(); rollback;
```

- [ ] **Passo 2: ver falhar** no CI. Esperado: função inexistente.

- [ ] **Passo 3: migration.**
```sql
-- Fase 3A: locais já usados pela empresa aparecem primeiro na busca (sem custo de Google).
create table app.locais_empresa (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references app.empresas(id),
  nome text not null check (char_length(nome) between 1 and 200),
  endereco text check (char_length(endereco) <= 300),
  lat numeric(9,6) not null check (lat between -90 and 90),
  lng numeric(9,6) not null check (lng between -180 and 180),
  place_id text check (place_id ~ '^[A-Za-z0-9_-]{1,300}$'),
  chave text not null,  -- place_id, ou nome + lat/lng com 5 casas quando não houver place_id
  usos int not null default 1,
  ultimo_uso timestamptz not null default now(),
  unique (empresa_id, chave)
);
alter table app.locais_empresa enable row level security;
-- Sem GRANT a authenticated: leitura por api.locais_da_empresa, escrita só por api.criar_pedido.

create function interno.guardar_local(p_empresa uuid, p_nome text, p_endereco text, p_lat numeric, p_lng numeric, p_place text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_lat is null or p_lng is null then return; end if;
  insert into app.locais_empresa (empresa_id, nome, endereco, lat, lng, place_id, chave)
  values (p_empresa, left(p_nome, 200), p_endereco, p_lat, p_lng, p_place,
          coalesce(p_place, lower(p_nome) || '@' || round(p_lat, 5) || ',' || round(p_lng, 5)))
  on conflict (empresa_id, chave) do update
    set usos = app.locais_empresa.usos + 1, ultimo_uso = now(), nome = excluded.nome, endereco = excluded.endereco;
end $$;

create function api.locais_da_empresa(p_texto text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  t text := lower(extensions.unaccent(coalesce(p_texto, '')));
begin
  if v is null or v.papel <> 'CLIENTE' or v.empresa_id is null then
    return interno.negar('LOCAIS_DA_EMPRESA', 'empresa', 'SEM_PERMISSAO');
  end if;
  if char_length(coalesce(p_texto, '')) > 120 then return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS'); end if;
  if not interno.checar_limite('LOCAIS_DA_EMPRESA', 600, interval '1 hour') then
    return interno.negar('LOCAIS_DA_EMPRESA', 'empresa:' || v.empresa_id, 'LIMITE_EXCEDIDO');
  end if;
  return jsonb_build_object('ok', true, 'locais', coalesce((
    select jsonb_agg(jsonb_build_object('nome', l.nome, 'endereco', l.endereco, 'lat', l.lat, 'lng', l.lng, 'place_id', l.place_id)
                     order by l.usos desc, l.ultimo_uso desc)
    from (select * from app.locais_empresa
          where empresa_id = v.empresa_id
            and (t = '' or lower(extensions.unaccent(nome || ' ' || coalesce(endereco, ''))) like '%' || t || '%')
          order by usos desc, ultimo_uso desc limit 5) l), '[]'::jsonb));
end $$;

revoke execute on function interno.guardar_local(uuid, text, text, numeric, numeric, text) from public, anon, authenticated;
revoke all on function api.locais_da_empresa(text) from public, anon, authenticated, service_role;
grant execute on function api.locais_da_empresa(text) to authenticated;
```
Antes, confira se a extensão `unaccent` existe: `grep -rn "unaccent" supabase/migrations`. Se não existir, comece a migration com `create extension if not exists unaccent with schema extensions;`.

Depois recrie `api.criar_pedido`, com `create or replace` sobre o corpo da Tarefa 1, e acrescente logo após o insert de sucesso:
```sql
  perform interno.guardar_local(v.empresa_id, p->>'origem', p->>'origem_endereco', (p->>'origem_lat')::numeric, (p->>'origem_lng')::numeric, p->>'origem_place_id');
  perform interno.guardar_local(v.empresa_id, p->>'destino', p->>'destino_endereco', (p->>'destino_lat')::numeric, (p->>'destino_lng')::numeric, p->>'destino_place_id');
```

- [ ] **Passo 4: ver passar** no CI: `0022` 6/6, `0021` e `0001` verdes.
- [ ] **Passo 5: commit.** Mensagem: `feat(fase 3A): locais da empresa na busca de endereços`.

---

### Tarefa 3: prévia do orçamento

**Arquivos:** criar `supabase/migrations/20261015120200_previa_orcamento.sql`, `supabase/tests/0023_previa_orcamento.test.sql` e `tests/integracao/mapas.test.ts`.

**Interfaces:**
- **Consome:** `interno.calcular_linhas(c app.contratos_versoes, p_levar boolean, p_trazer boolean, p_modalidade app.modalidade, e jsonb)` e `interno.contrato_vigente(p_empresa uuid)`.
- **Produz:** `api.previa_orcamento(p jsonb) returns jsonb`.
  - Entrada: `{km:number(1 casa), usa_reboque:boolean, levar:boolean, trazer:boolean, modalidade:'VEICULO_PROPRIO'|'VEICULO_CLIENTE'}`.
  - Saída: o retorno de `calcular_linhas`, ou seja `{ok, modalidade, linhas, total_cent}`.

- [ ] **Passo 1: pgTAP que falha** (`0023`):
```sql
select plan(6);
-- Empresa A com contrato t.base; N1 (...a1), N2 (...a5), N3 (...a6), motorista (...m1).
select set_config('t.e', '{"km": 38, "usa_reboque": true, "levar": true, "trazer": false, "modalidade": "VEICULO_PROPRIO"}', true);
-- como N2:
select is(api.previa_orcamento(current_setting('t.e')::jsonb) ->> 'ok', 'true', 'N2 vê a prévia');
select is((api.previa_orcamento(current_setting('t.e')::jsonb) ->> 'total_cent')::int,
  (interno.calcular_linhas((select c from interno.contrato_vigente('00000000-0000-0000-0000-0000000000e1') c), true, false,
   'VEICULO_PROPRIO', '{"km": 38, "usa_reboque": true}') ->> 'total_cent')::int, 'prévia = conta do orçamento do motorista');
-- como N3:
select is(api.previa_orcamento(current_setting('t.e')::jsonb) ->> 'codigo', 'SEM_PERMISSAO', 'N3 não vê');
-- como motorista:
select is(api.previa_orcamento(current_setting('t.e')::jsonb) ->> 'codigo', 'SEM_PERMISSAO', 'equipe não usa a prévia do cliente');
-- como N2, entrada ruim:
select is(api.previa_orcamento('{"km": 38, "usa_reboque": true, "levar": true, "trazer": false, "modalidade": "VEICULO_PROPRIO", "espera_horas": 2}') ->> 'codigo', 'CAMPOS_INVALIDOS', 'só km e reboque');
reset role;
select ok((select count(*) from app.auditoria where acao = 'PREVIA_ORCAMENTO' and resultado = 'NEGADO') >= 2, 'recusas auditadas');
select * from finish(); rollback;
```
Na hora de copiar, confira o nome da tabela e das colunas de auditoria em `20261008130100_acesso_correcoes.sql:62`.

- [ ] **Passo 2: ver falhar** no CI.

- [ ] **Passo 3: migration.** Recrie `app.pode_fazer`: copie a última versão de `20261009140000_saldo_livro_razao.sql:220` com `create or replace` e acrescente o ramo:
```sql
    when 'PREVIA_ORCAMENTO' then return v.papel = 'CLIENTE' and v.nivel in (1, 2) and v.empresa_id is not null;
```
Depois crie a função:
```sql
create function api.previa_orcamento(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  c app.contratos_versoes;
  e jsonb;
begin
  if not (select app.pode_fazer('PREVIA_ORCAMENTO')) then
    return interno.negar('PREVIA_ORCAMENTO', 'empresa', 'SEM_PERMISSAO');
  end if;
  if not interno.checar_limite('PREVIA_ORCAMENTO', 300, interval '1 hour') then
    return interno.negar('PREVIA_ORCAMENTO', 'empresa:' || v.empresa_id, 'LIMITE_EXCEDIDO');
  end if;
  if jsonb_typeof(p) <> 'object'
     or exists (select 1 from jsonb_object_keys(p) k where k not in ('km','usa_reboque','levar','trazer','modalidade'))
     or jsonb_typeof(p->'levar') <> 'boolean' or jsonb_typeof(p->'trazer') <> 'boolean'
     or coalesce(p->>'modalidade','') not in ('VEICULO_PROPRIO','VEICULO_CLIENTE') then
    return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS');
  end if;
  select * into c from interno.contrato_vigente(v.empresa_id);
  if c is null then return jsonb_build_object('ok', false, 'codigo', 'SEM_CONTRATO'); end if;
  -- Só km e reboque (no veículo próprio); o resto do orçamento é do motorista.
  e := case when p->>'modalidade' = 'VEICULO_PROPRIO'
            then jsonb_build_object('km', p->'km', 'usa_reboque', coalesce(p->'usa_reboque', 'false'::jsonb))
            else '{}'::jsonb end;
  return interno.calcular_linhas(c, (p->>'levar')::boolean, (p->>'trazer')::boolean, (p->>'modalidade')::app.modalidade, e);
end $$;
revoke all on function api.previa_orcamento(jsonb) from public, anon, authenticated, service_role;
grant execute on function api.previa_orcamento(jsonb) to authenticated;
```

- [ ] **Passo 4: teste de integração** (`tests/integracao/mapas.test.ts`), contra o banco real do CI:
```ts
import { describe, expect, it } from 'vitest'
import { criarPessoa, empresaComContrato, motoristaUnico, rpc } from './ajuda.ts'

describe('prévia do orçamento', () => {
  it('dá o mesmo total que o orçamento do motorista para os mesmos km', async () => {
    const empresa = await empresaComContrato()
    const n2 = await criarPessoa({ papel: 'CLIENTE', nivel: 2, empresa })
    const motorista = await motoristaUnico()
    const criado = await rpc(n2, 'criar_pedido', { p: {
      inicio: new Date(Date.now() + 5 * 86_400_000).toISOString(), duracao_min: 120, origem: 'Porto', destino: 'Estaleiro',
      levar: true, trazer: false, carga: 'PESSOAS', modalidade: 'VEICULO_PROPRIO', reboque: 'SIM', pessoas_qtd: 1, km_estimado: 38 } })
    const previa = await rpc(n2, 'previa_orcamento', { p: { km: 38, usa_reboque: true, levar: true, trazer: false, modalidade: 'VEICULO_PROPRIO' } })
    const orcamento = await rpc(motorista, 'calcular_orcamento', { p_atividade: criado.id, p: { km: 38, usa_reboque: true } })
    expect(previa.ok).toBe(true)
    expect(previa.total_cent).toBe(orcamento.total_cent)
  })
})
```
Antes de rodar, confira a forma de retorno de `rpc` e de `motoristaUnico` em `tests/integracao/ajuda.ts` e ajuste o acesso aos campos.

- [ ] **Passo 5: ver passar** no CI: `0023` e o teste de integração.
- [ ] **Passo 6: commit.** Mensagem: `feat(fase 3A): prévia do orçamento pela tabela do contrato`.

---

### Tarefa 4: uso dos mapas (limite e teto diário por empresa)

**Arquivos:** criar `supabase/migrations/20261015120300_uso_mapas.sql` e `supabase/tests/0024_uso_mapas.test.sql`.

**Interfaces:**
- **Produz:** `api.registrar_uso_mapas(p_tipo text) returns jsonb`, com `p_tipo` em `'SUGERIR' | 'DETALHAR' | 'ROTA'`. Devolve `{ok:true}`, `{ok:false, codigo:'LIMITE_EXCEDIDO'}` ou `{ok:false, codigo:'TETO_DIARIO'}`.
  - liberada para cliente N1, N2 e N3 e para a equipe (ADM, gestor de frota e motorista);
  - limites por usuário: SUGERIR 60/min, DETALHAR 30/min, ROTA 20/min;
  - teto por empresa: `app.configuracoes.mapas_teto_diario_empresa`, padrão 2000, por dia em America/Sao_Paulo. A equipe conta no teto da empresa `'IVO'` (empresa nula).

- [ ] **Passo 1: pgTAP que falha** (`0024`):
```sql
select plan(5);
-- Empresa A, N2 ...a5; configuração com teto 3 para o teste.
reset role;
insert into app.configuracoes (chave, valor) values ('mapas_teto_diario_empresa', '3'::jsonb)
  on conflict (chave) do update set valor = excluded.valor;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.registrar_uso_mapas('SUGERIR') ->> 'ok', 'true', '1ª chamada');
select is(api.registrar_uso_mapas('ROTA') ->> 'ok', 'true', '2ª');
select is(api.registrar_uso_mapas('DETALHAR') ->> 'ok', 'true', '3ª');
select is(api.registrar_uso_mapas('SUGERIR') ->> 'codigo', 'TETO_DIARIO', 'acima do teto da empresa');
select is(api.registrar_uso_mapas('OUTRO') ->> 'codigo', 'CAMPOS_INVALIDOS', 'tipo desconhecido');
select * from finish(); rollback;
```
Confira o nome e as colunas reais da tabela de configurações com `grep -n "create table app.configuracoes" -A8 supabase/migrations/*.sql` e ajuste o insert.

- [ ] **Passo 2: ver falhar** no CI.

- [ ] **Passo 3: migration.**
```sql
-- Fase 3A: cada chamada ao Google passa por aqui antes (limite por usuário + teto diário por empresa).
create table app.uso_mapas (
  empresa_chave text not null,          -- empresa_id, ou 'IVO' para a equipe
  dia date not null,
  chamadas int not null default 0,
  primary key (empresa_chave, dia)
);
alter table app.uso_mapas enable row level security;
insert into app.configuracoes (chave, valor) values ('mapas_teto_diario_empresa', '2000'::jsonb) on conflict do nothing;

create function api.registrar_uso_mapas(p_tipo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v app.perfis := app.pode_acessar();
  k text;
  teto int;
  n int;
  maximo int := case p_tipo when 'SUGERIR' then 60 when 'DETALHAR' then 30 when 'ROTA' then 20 end;
begin
  if v is null then return interno.negar('USO_MAPAS', 'mapas', 'SEM_PERMISSAO'); end if;
  if maximo is null then return jsonb_build_object('ok', false, 'codigo', 'CAMPOS_INVALIDOS'); end if;
  if not interno.checar_limite('MAPAS_' || p_tipo, maximo, interval '1 minute') then
    return interno.negar('USO_MAPAS', 'mapas:' || p_tipo, 'LIMITE_EXCEDIDO');
  end if;
  k := coalesce(v.empresa_id::text, 'IVO');
  teto := coalesce((select (valor #>> '{}')::int from app.configuracoes where chave = 'mapas_teto_diario_empresa'), 2000);
  insert into app.uso_mapas (empresa_chave, dia, chamadas)
  values (k, (now() at time zone 'America/Sao_Paulo')::date, 1)
  on conflict (empresa_chave, dia) do update set chamadas = app.uso_mapas.chamadas + 1
  returning chamadas into n;
  if n > teto then return interno.negar('USO_MAPAS', 'empresa:' || k, 'TETO_DIARIO'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function api.registrar_uso_mapas(text) from public, anon, authenticated, service_role;
grant execute on function api.registrar_uso_mapas(text) to authenticated;
```
Para o ADM ajustar o teto, acrescente a chave `mapas_teto_diario_empresa` na RPC de configurações existente (`grep -n "retencao" supabase/migrations/*.sql` mostra o padrão das chaves aceitas) e um campo em `src/telas/adm/Configuracoes.tsx`, seguindo o cartão de retenção de fotos.

- [ ] **Passo 4: ver passar** no CI.
- [ ] **Passo 5: commit.** Mensagem: `feat(fase 3A): limite e teto diário de chamadas aos mapas`.

---

### Tarefa 5: Edge Function `enderecos`

**Arquivos:**
- criar `supabase/functions/enderecos/index.ts`, `supabase/functions/enderecos/google.ts` e `supabase/functions/enderecos/enderecos.test.ts`;
- modificar `supabase/config.toml`, `.github/workflows/ci.yml` e `.github/workflows/deploy.yml`.

**Interfaces:**
- **Consome:** `criarServidor` (`_compartilhado/servidor.ts`), `api.registrar_uso_mapas` (Tarefa 4) e o contexto `ctx.usuario.rpc`.
- **Produz:** `POST /functions/v1/enderecos`. O corpo é uma destas formas:
  - `{acao:'sugerir', texto, sessao}` → `{ok:true, sugestoes:[{place_id, nome, endereco}]}`
  - `{acao:'detalhar', place_id, sessao, nome}` → `{ok:true, local:{nome, endereco, lat, lng, place_id}}`
  - `{acao:'rota', origem:{lat,lng}, destino:{lat,lng}}` → `{ok:true, km:number|null, minutos:number|null}`

  Os erros possíveis: `CAMPOS_INVALIDOS`, `LIMITE_EXCEDIDO`, `TETO_DIARIO`, `MAPAS_INDISPONIVEL` (sem chave configurada ou Google fora do ar).
- **Também produz:** `criarManipuladorEnderecos(deps: { chave: string | null; buscar: typeof fetch; registrarUso: (tipo) => Promise<{ok:boolean; codigo?:string}> })`, uma função pura e testável.

- [ ] **Passo 1: testes que falham** (`enderecos.test.ts`, rodando no Vitest):
```ts
import { describe, expect, it } from 'vitest'
import { criarManipuladorEnderecos } from './google.ts'

const ok = async () => ({ ok: true })
const resp = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status })
const SESSAO = '3f1c2a9e-1d2b-4c3d-8e4f-5a6b7c8d9e0f'

describe('enderecos', () => {
  it('sugerir: repassa com token de sessão, região BR e pt-BR; devolve nome e endereço; nunca a chave', async () => {
    const pedidos: Array<{ url: string; init: RequestInit }> = []
    const buscar = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, init })
      return resp({ suggestions: [{ placePrediction: { placeId: 'ChIJdef', structuredFormat: {
        mainText: { text: 'Estaleiro Navegantes' }, secondaryText: { text: 'Navegantes, SC' } } } }] })
    }) as unknown as typeof fetch
    const m = criarManipuladorEnderecos({ chave: 'CHAVE-SECRETA', buscar, registrarUso: ok })
    const r = await m({ acao: 'sugerir', texto: 'estaleiro nav', sessao: SESSAO })
    expect(r).toEqual({ ok: true, sugestoes: [{ place_id: 'ChIJdef', nome: 'Estaleiro Navegantes', endereco: 'Navegantes, SC' }] })
    expect(pedidos[0]!.url).toBe('https://places.googleapis.com/v1/places:autocomplete')
    const corpo = JSON.parse(String(pedidos[0]!.init.body))
    expect(corpo).toMatchObject({ input: 'estaleiro nav', sessionToken: SESSAO, includedRegionCodes: ['br'], languageCode: 'pt-BR' })
    expect(JSON.stringify(r)).not.toContain('CHAVE-SECRETA')
  })

  it('detalhar: pede só campos Essentials e usa o nome da sugestão', async () => {
    let cabecalhos: Headers | undefined
    let url = ''
    const buscar = (async (u: string, init: RequestInit) => {
      url = u; cabecalhos = new Headers(init.headers)
      return resp({ id: 'ChIJdef', formattedAddress: 'Av. Pref. Cirino Adolfo Cabral, 1500', location: { latitude: -26.8986, longitude: -48.6542 } })
    }) as unknown as typeof fetch
    const m = criarManipuladorEnderecos({ chave: 'K', buscar, registrarUso: ok })
    const r = await m({ acao: 'detalhar', place_id: 'ChIJdef', sessao: SESSAO, nome: 'Estaleiro Navegantes' })
    expect(cabecalhos!.get('X-Goog-FieldMask')).toBe('id,formattedAddress,location')
    expect(url).toBe(`https://places.googleapis.com/v1/places/ChIJdef?sessionToken=${SESSAO}&languageCode=pt-BR`)
    expect(r).toEqual({ ok: true, local: { nome: 'Estaleiro Navegantes', endereco: 'Av. Pref. Cirino Adolfo Cabral, 1500', lat: -26.8986, lng: -48.6542, place_id: 'ChIJdef' } })
  })

  it('rota: km com 1 casa e minutos arredondados; sem rota devolve km null', async () => {
    const buscar = (async () => resp({ routes: [{ distanceMeters: 38240, duration: '2712s' }] })) as unknown as typeof fetch
    const m = criarManipuladorEnderecos({ chave: 'K', buscar, registrarUso: ok })
    expect(await m({ acao: 'rota', origem: { lat: -26.9, lng: -48.66 }, destino: { lat: -26.89, lng: -48.65 } })).toEqual({ ok: true, km: 38.2, minutos: 45 })
    const vazio = criarManipuladorEnderecos({ chave: 'K', buscar: (async () => resp({})) as unknown as typeof fetch, registrarUso: ok })
    expect(await vazio({ acao: 'rota', origem: { lat: -26.9, lng: -48.66 }, destino: { lat: -26.9, lng: -48.66 } })).toEqual({ ok: true, km: null, minutos: null })
  })

  it('valida a entrada antes de gastar chamada', async () => {
    let chamou = false
    const m = criarManipuladorEnderecos({ chave: 'K', buscar: (async () => { chamou = true; return resp({}) }) as unknown as typeof fetch, registrarUso: ok })
    expect(await m({ acao: 'sugerir', texto: 'ab', sessao: SESSAO })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(await m({ acao: 'sugerir', texto: 'porto', sessao: 'nao-uuid' })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(await m({ acao: 'detalhar', place_id: '../x', sessao: SESSAO, nome: 'x' })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(await m({ acao: 'rota', origem: { lat: 40, lng: -48 }, destino: { lat: -26, lng: -48 } })).toEqual({ ok: false, codigo: 'CAMPOS_INVALIDOS' })
    expect(chamou).toBe(false)
  })

  it('limite do banco, sem chave e Google fora do ar', async () => {
    const recusa = async () => ({ ok: false, codigo: 'TETO_DIARIO' })
    const m1 = criarManipuladorEnderecos({ chave: 'K', buscar: (async () => resp({})) as unknown as typeof fetch, registrarUso: recusa })
    expect(await m1({ acao: 'sugerir', texto: 'porto', sessao: SESSAO })).toEqual({ ok: false, codigo: 'TETO_DIARIO' })
    const m2 = criarManipuladorEnderecos({ chave: null, buscar: (async () => resp({})) as unknown as typeof fetch, registrarUso: ok })
    expect(await m2({ acao: 'sugerir', texto: 'porto', sessao: SESSAO })).toEqual({ ok: false, codigo: 'MAPAS_INDISPONIVEL' })
    const m3 = criarManipuladorEnderecos({ chave: 'K', buscar: (async () => resp({ error: {} }, 500)) as unknown as typeof fetch, registrarUso: ok })
    expect(await m3({ acao: 'sugerir', texto: 'porto', sessao: SESSAO })).toEqual({ ok: false, codigo: 'MAPAS_INDISPONIVEL' })
  })
})
```

- [ ] **Passo 2: ver falhar.** Rode `npx vitest run supabase/functions/enderecos`. Esperado: o módulo ainda não existe.

- [ ] **Passo 3: implementar `google.ts`:**
```ts
// Cliente do Google Maps Platform para a função `enderecos`: URLs fixas (nada vindo do usuário), tempo limite de 5 s,
// campos mínimos (faixa Essentials) e token de sessão no autocompletar. A chave nunca sai na resposta.
type Corpo = { ok: boolean; codigo?: string; [k: string]: unknown }
type Uso = (tipo: 'SUGERIR' | 'DETALHAR' | 'ROTA') => Promise<{ ok: boolean; codigo?: string }>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PLACE = /^[A-Za-z0-9_-]{1,300}$/
// Caixa aproximada do Brasil.
const noBrasil = (p: unknown): p is { lat: number; lng: number } =>
  typeof p === 'object' && p !== null && typeof (p as { lat: unknown }).lat === 'number' && typeof (p as { lng: unknown }).lng === 'number' &&
  (p as { lat: number }).lat >= -34 && (p as { lat: number }).lat <= 6 && (p as { lng: number }).lng >= -74 && (p as { lng: number }).lng <= -28
// Viés para Santa Catarina.
const SC = { rectangle: { low: { latitude: -29.4, longitude: -53.9 }, high: { latitude: -25.9, longitude: -48.3 } } }
const INVALIDO: Corpo = { ok: false, codigo: 'CAMPOS_INVALIDOS' }
const INDISPONIVEL: Corpo = { ok: false, codigo: 'MAPAS_INDISPONIVEL' }

export function criarManipuladorEnderecos(deps: { chave: string | null; buscar: typeof fetch; registrarUso: Uso }) {
  const chamar = async (url: string, init: RequestInit, mascara?: string): Promise<unknown | null> => {
    const headers = new Headers(init.headers)
    headers.set('X-Goog-Api-Key', deps.chave!)
    headers.set('Content-Type', 'application/json')
    if (mascara) headers.set('X-Goog-FieldMask', mascara)
    try {
      const r = await deps.buscar(url, { ...init, headers, signal: AbortSignal.timeout(5000) })
      return r.ok ? await r.json() : null
    } catch {
      return null
    }
  }

  return async (c: Record<string, unknown>): Promise<Corpo> => {
    const acao = c.acao
    if (acao === 'sugerir') {
      const texto = typeof c.texto === 'string' ? c.texto.trim() : ''
      if (texto.length < 3 || texto.length > 120 || typeof c.sessao !== 'string' || !UUID.test(c.sessao)) return INVALIDO
    } else if (acao === 'detalhar') {
      if (typeof c.place_id !== 'string' || !PLACE.test(c.place_id) || typeof c.sessao !== 'string' || !UUID.test(c.sessao)
          || typeof c.nome !== 'string' || c.nome.length < 1 || c.nome.length > 200) return INVALIDO
    } else if (acao === 'rota') {
      if (!noBrasil(c.origem) || !noBrasil(c.destino)) return INVALIDO
    } else return INVALIDO

    if (!deps.chave) return INDISPONIVEL
    const uso = await deps.registrarUso(acao === 'sugerir' ? 'SUGERIR' : acao === 'detalhar' ? 'DETALHAR' : 'ROTA')
    if (!uso.ok) return { ok: false, codigo: uso.codigo ?? 'LIMITE_EXCEDIDO' }

    if (acao === 'sugerir') {
      const r = (await chamar('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        body: JSON.stringify({ input: String(c.texto).trim(), sessionToken: c.sessao, includedRegionCodes: ['br'], languageCode: 'pt-BR', locationBias: SC }),
      })) as { suggestions?: Array<{ placePrediction?: { placeId: string; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }> } | null
      if (!r) return INDISPONIVEL
      const sugestoes = (r.suggestions ?? []).flatMap((s) => {
        const p = s.placePrediction
        return p ? [{ place_id: p.placeId, nome: p.structuredFormat?.mainText?.text ?? '', endereco: p.structuredFormat?.secondaryText?.text ?? '' }] : []
      }).slice(0, 5)
      return { ok: true, sugestoes }
    }
    if (acao === 'detalhar') {
      const r = (await chamar(`https://places.googleapis.com/v1/places/${c.place_id}?sessionToken=${c.sessao}&languageCode=pt-BR`,
        { method: 'GET' }, 'id,formattedAddress,location')) as { id?: string; formattedAddress?: string; location?: { latitude: number; longitude: number } } | null
      if (!r?.location) return INDISPONIVEL
      return { ok: true, local: { nome: c.nome, endereco: r.formattedAddress ?? null, lat: r.location.latitude, lng: r.location.longitude, place_id: r.id ?? c.place_id } }
    }
    const o = c.origem as { lat: number; lng: number }
    const d = c.destino as { lat: number; lng: number }
    const r = (await chamar('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: o.lat, longitude: o.lng } } },
        destination: { location: { latLng: { latitude: d.lat, longitude: d.lng } } },
        travelMode: 'DRIVE', languageCode: 'pt-BR', units: 'METRIC',
      }),
    }, 'routes.distanceMeters,routes.duration')) as { routes?: Array<{ distanceMeters?: number; duration?: string }> } | null
    if (!r) return INDISPONIVEL
    const rota = r.routes?.[0]
    if (!rota?.distanceMeters) return { ok: true, km: null, minutos: null }
    return { ok: true, km: Math.round(rota.distanceMeters / 100) / 10, minutos: Math.round(parseInt(rota.duration ?? '0', 10) / 60) }
  }
}
```
Depois implemente `index.ts`:
```ts
import { criarServidor } from '../_compartilhado/servidor.ts'
import { criarManipuladorEnderecos } from './google.ts'

Deno.serve(criarServidor('enderecos', async (ctx) => {
  const manipular = criarManipuladorEnderecos({
    chave: Deno.env.get('GOOGLE_MAPS_CHAVE_SERVIDOR') ?? null,
    buscar: fetch,
    registrarUso: async (tipo) => {
      const { data, error } = await ctx.usuario.rpc('registrar_uso_mapas', { p_tipo: tipo })
      return error || !data ? { ok: false, codigo: 'ERRO_INESPERADO' } : (data as { ok: boolean; codigo?: string })
    },
  })
  return manipular(ctx.corpo as Record<string, unknown>)
}))
```
Confira a forma exata do handler e do `ctx` em `supabase/functions/convidar/index.ts` e alinhe: o retorno de `criarServidor` e o nome `ctx.corpo`.

Na configuração:
- `supabase/config.toml`: acrescente `[functions.enderecos]` com `verify_jwt = false`, como as outras funções.
- `ci.yml`: não defina `GOOGLE_MAPS_CHAVE_SERVIDOR`. No CI a função devolve `MAPAS_INDISPONIVEL`, e o e2e simula a função.
- `deploy.yml`, no passo do Supabase: acrescente `npx supabase secrets set GOOGLE_MAPS_CHAVE_SERVIDOR="$GOOGLE_MAPS_CHAVE_SERVIDOR" --project-ref "$REF"` e `GOOGLE_MAPS_CHAVE_SERVIDOR: ${{ secrets.GOOGLE_MAPS_CHAVE_SERVIDOR }}` no `env` do passo.
- `deploy.yml`, no passo de build: acrescente `VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR: ${{ vars.VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR }}`.

- [ ] **Passo 4: ver passar.** Rode `npx vitest run supabase/functions/enderecos`: 5/5. No CI, `tests/integracao/funcoes.test.ts` ganha um caso: `chamar('enderecos', token, {acao:'sugerir', texto:'porto', sessao: <uuid>})` deve devolver `{ok:false, codigo:'MAPAS_INDISPONIVEL'}` (sem chave no CI). Garante que a função sobe e autentica.
- [ ] **Passo 5: commit.** Mensagem: `feat(fase 3A): função enderecos (Places New e Routes, chave só no servidor)`.

---

### Tarefa 6: biblioteca do front (`src/lib/enderecos.ts`)

**Arquivos:** criar `src/lib/enderecos.ts` e `src/lib/enderecos.test.ts`.

**Interfaces:**
- **Consome:** `criarChamador` de `src/lib/funcoes.ts` (confira o nome exato da função que chama Edge Functions com o token) e `supabase.rpc('locais_da_empresa', ...)`.
- **Produz:**
  - `type Local = { nome: string; endereco: string | null; lat: number; lng: number; place_id: string | null }`
  - `type Sugestao = { place_id: string; nome: string; endereco: string; daEmpresa?: false } | (Local & { daEmpresa: true })`
  - `criarSessaoDeBusca(gerarId = () => crypto.randomUUID())` devolve:
    - `{ token(): string; encerrar(): void; buscar(texto): Promise<Sugestao[] | null> }`
    - `null` quando a resposta ficou velha;
    - `encerrar()` gera um token novo;
    - quem chama "detalhar" deve usar `token()` e depois `encerrar()`.
  - `detalhar(placeId, nome, sessao): Promise<Local | null>`
  - `rota(o: Local, d: Local): Promise<{ km: number | null; minutos: number | null }>`
  - `formatarRota(km, minutos): string` → `"38 km pela rota"` e `"cerca de 45 min"` (ou `"cerca de 1 h 5 min"`).

- [ ] **Passo 1: testes que falham:**
```ts
import { describe, expect, it } from 'vitest'
import { criarSessaoDeBusca, formatarRota } from './enderecos.ts'

describe('sessão de busca', () => {
  it('a mesma sessão usa o mesmo token até encerrar; depois, token novo', () => {
    let n = 0
    const s = criarSessaoDeBusca(() => `t${++n}`)
    expect(s.token()).toBe('t1')
    expect(s.token()).toBe('t1')
    s.encerrar()
    expect(s.token()).toBe('t2')
  })

  it('última resposta vence: a resposta de uma digitação antiga vira null', async () => {
    const respostas: Array<(v: unknown) => void> = []
    const s = criarSessaoDeBusca(() => 't', (() => new Promise((r) => respostas.push(r))) as never)
    const antiga = s.buscar('estal')
    const nova = s.buscar('estaleiro')
    respostas[1]!([{ place_id: 'b', nome: 'B', endereco: '' }])
    respostas[0]!([{ place_id: 'a', nome: 'A', endereco: '' }])
    expect(await antiga).toBeNull()
    expect(await nova).toEqual([{ place_id: 'b', nome: 'B', endereco: '' }])
  })
})

describe('formatarRota', () => {
  it('km e minutos legíveis', () => {
    expect(formatarRota(38.2, 45)).toEqual({ km: '38 km pela rota', tempo: 'cerca de 45 min' })
    expect(formatarRota(120.4, 65)).toEqual({ km: '120 km pela rota', tempo: 'cerca de 1 h 5 min' })
    expect(formatarRota(0.4, 2)).toEqual({ km: 'menos de 1 km', tempo: 'cerca de 2 min' })
  })
})
```

- [ ] **Passo 2: ver falhar** com `npx vitest run src/lib/enderecos.test.ts`.

- [ ] **Passo 3: implementar.** Para manter os testes puros, `criarSessaoDeBusca(gerarId, buscarRemoto?)` recebe o buscador por injeção. A versão real usa `buscarSugestoes(texto, token)`, que junta os `locais_da_empresa` (RPC) com o resultado de `sugerir` (função) e marca `daEmpresa`, removendo do Google o que já veio da empresa pelo `place_id`. `formatarRota` usa `formatarDuracao` de `tempo.ts` para o tempo. O controle de "última resposta vence" usa um contador interno: cada `buscar` pega o próximo número, e só devolve dados se ainda for o último.
- [ ] **Passo 4: ver passar.**
- [ ] **Passo 5: commit.** Mensagem: `feat(fase 3A): sessão de busca de endereços no front`.

---

### Tarefa 7: CSP com os blocos do mapa do Google

**Arquivos:** modificar `scripts/gerar-headers.ts` e `scripts/gerar-headers.test.ts`.

- [ ] **Passo 1: teste que falha:**
```ts
it('libera só os blocos do mapa do Google (imagem e sessão), sem script novo', () => {
  const csp = montarCsp('https://abc.supabase.co')
  expect(csp).toContain("img-src 'self' data: blob: https://abc.supabase.co https://tile.googleapis.com")
  expect(csp).toMatch(/connect-src [^;]*https:\/\/tile\.googleapis\.com/)
  expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com;")
  expect(csp).not.toMatch(/unsafe-(inline|eval)/)
})
```
- [ ] **Passo 2: ver falhar** com `npx vitest run scripts/gerar-headers.test.ts`.
- [ ] **Passo 3:** em `montarCsp`, acrescente `'https://tile.googleapis.com'` ao fim das listas de `img-src` e `connect-src`.
- [ ] **Passo 4: ver passar.** Depois rode `npm run build:test` e `npx playwright test seguranca.spec.ts`, para garantir a CSP sem violações.
- [ ] **Passo 5: commit.** Mensagem: `feat(fase 3A): CSP libera os blocos do mapa do Google`.

---

### Tarefa 8: campo de endereço com sugestões

**Arquivos:**
- criar `src/telas/pedidos/CampoEndereco.tsx`, `tests/e2e/apoio/mapasFalsos.ts` e `tests/e2e/enderecos.spec.ts`.

**Interfaces:**
- **Consome:** `criarSessaoDeBusca`, `detalhar` e `Local`, todos da Tarefa 6.
- **Produz:**
  - `CampoEndereco({ rotulo: 'Origem' | 'Destino'; valor: { texto: string; local: Local | null }; aoMudar(v): void; aoMarcarNoMapa(): void; erro?: string })`;
  - `simularMapas(page, opcoes?)` em `mapasFalsos.ts`:
    - simula `/functions/v1/enderecos` e `/rest/v1/rpc/locais_da_empresa`;
    - opções: `{ fora?: boolean; atrasoSugestao?: number; semRota?: boolean }`;
    - devolve as chamadas recebidas.

- [ ] **Passo 1: e2e que falha** (`enderecos.spec.ts`):
```ts
test('digitar mostra locais da empresa primeiro, depois Google; escolher preenche nome e endereço', async ({ page }) => {
  await comSessaoFalsa(page, N2); await simularApi(page); await simularPedidos(page)
  const chamadas = await simularMapas(page)
  await page.goto('/pedidos/novo')
  // passo 1 (como em pedidos-cliente.spec.ts) e "Continuar"
  const destino = page.getByRole('combobox', { name: 'Destino' })
  await destino.fill('estaleiro nav')
  const lista = page.getByRole('listbox', { name: 'Sugestões para Destino' })
  await expect(lista.getByRole('option').first()).toContainText('Estaleiro Navegantes')
  await expect(lista.getByRole('option').first()).toContainText('Locais da empresa')
  await lista.getByRole('option', { name: /Estaleiro Navship/ }).click()
  await expect(destino).toHaveValue('Estaleiro Navship')
  await expect(page.getByTestId('endereco-destino')).toHaveText('Rua Prefeito José Juvenal Mafra, Navegantes, SC')
  const sugerir = chamadas.filter((c) => c.acao === 'sugerir'), detalhar = chamadas.filter((c) => c.acao === 'detalhar')
  expect(new Set(sugerir.map((c) => c.sessao)).size).toBe(1)
  expect(detalhar[0]!.sessao).toBe(sugerir[0]!.sessao)
})

test('Google fora do ar: campo vira texto livre com aviso e o pedido segue', async ({ page }) => {
  // simularMapas(page, { fora: true }); digita "Marina do Saco da Fazenda"; espera o texto
  // "Não foi possível buscar endereços agora. Escreva o local; o motorista confere os km."; "Continuar" leva ao passo 3.
})

test('resposta atrasada de uma digitação antiga não substitui a nova', async ({ page }) => {
  // simularMapas(page, { atrasoSugestao: 800 }) só para "estal"; digita "estal" e logo "estaleiro";
  // a lista final mostra as sugestões de "estaleiro".
})

test('teclado: setas e Enter escolhem; Esc fecha; leitor de tela ouve "N sugestões"', async ({ page }) => {
  // ArrowDown duas vezes + Enter escolhe a 2ª; aria-activedescendant acompanha; status com "3 sugestões".
})
```
Complete os três últimos testes com o mesmo padrão do primeiro. Os comentários dizem exatamente o que cada um verifica.

- [ ] **Passo 2: ver falhar** com `npm run build:test && npx playwright test enderecos.spec.ts --project=celular`.

- [ ] **Passo 3: implementar `CampoEndereco`.**
  - Segue o padrão ARIA de combobox com listbox: `role="combobox"`, `aria-expanded`, `aria-controls` e `aria-activedescendant`. O debounce é de 250 ms, e a busca começa com 3 letras ou mais. Os locais da empresa aparecem a partir de 0 letras, ao focar.
  - Lista em `Cartao` com dois grupos: "Locais da empresa", com o ícone `predio` e fundo `bg-selecao-suave` no item, e "Sugestões". No fim vai o item "Não achou? Marcar no mapa", que chama `aoMarcarNoMapa`.
  - Ao escolher uma sugestão do Google, chama `detalhar` com o token da sessão e depois `encerrar()`. Ao fechar sem escolher, também chama `encerrar()`.
  - Abaixo do campo, `p data-testid="endereco-origem|destino"` mostra o endereço formatado.
  - Com a função devolvendo `MAPAS_INDISPONIVEL`, `TETO_DIARIO` ou erro de rede, o campo vira texto livre e mostra a `Mensagem` com o aviso da especificação.
  - Textos exatos da especificação (§7).
- [ ] **Passo 4: ver passar,** nos projetos `celular` e `iphone`.
- [ ] **Passo 5: commit.** Mensagem: `feat(fase 3A): campo de endereço com locais da empresa e sugestões do Google`.

---

### Tarefa 9: folha "Marcar no mapa"

**Arquivos:**
- criar `src/lib/mapaTiles.ts`, `src/telas/pedidos/FolhaMarcarNoMapa.tsx` e `tests/e2e/toque-enderecos.spec.ts`;
- modificar `package.json` (dependência `leaflet@1.9.4`, exata, e `@types/leaflet`).

**Interfaces:**
- **Produz:**
  - `criarSessaoTiles(chave): Promise<{ session: string; urlTile: string }>`: faz `POST https://tile.googleapis.com/v1/createSession?key=CHAVE` com `{mapType:'roadmap', language:'pt-BR', region:'BR'}`. A `urlTile` é `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=S&key=CHAVE`.
  - `FolhaMarcarNoMapa({ aberta, centro: {lat,lng} | null, aoFechar, aoUsar(local: Local) })`.

- [ ] **Passo 1: e2e de toque que falha** (`toque-enderecos.spec.ts`, Pixel e iPhone, claro e escuro).
  - Simule `https://tile.googleapis.com/**`: `createSession` responde `{session:'s1'}`, e os blocos respondem um PNG 1×1.
  - O teste toca em "Não achou? Marcar no mapa" e vê a folha "Marcar no mapa".
  - Arrasta o mapa com `page.mouse` (ou toque) e escreve "Marina Itajaí, rampa 2" em "Nome do local".
  - Toca em "Usar este ponto": o campo Destino mostra "Marina Itajaí, rampa 2" e a folha fecha.
  - Confere que o pino tem o triângulo (`svg path[fill="var(--cor-laranja)"]`), que a atribuição "Google" aparece e que `vigiarCsp` dá zero violações.
  - Com o movimento reduzido ligado, confere que `zoomAnimation` está desligado: o mapa expõe `data-animacao="nao"`.
- [ ] **Passo 2: ver falhar.**
- [ ] **Passo 3: implementar.**
  - `FolhaMarcarNoMapa` usa `Folha` em altura quase cheia. O Leaflet é carregado com `const L = await import('leaflet')`, e o CSS com `import('leaflet/dist/leaflet.css')`. O Vite emite o CSS como arquivo, o que é compatível com `style-src 'self'`.
  - `L.map(div, { zoomControl: true, attributionControl: true, zoomAnimation: !reduzido, fadeAnimation: !reduzido })` e `L.tileLayer(urlTile, { maxZoom: 20, attribution: 'Google' })`.
  - O pino fica fixo no centro, como um `div` sobre o mapa. Ao confirmar, usa `map.getCenter()`.
  - Sem `VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR`, ou se a sessão falhar, a folha mostra "O mapa não está disponível agora. Escreva o local; o motorista confere os km." e fecha.
- [ ] **Passo 4: ver passar** e rodar `node scripts/orcamento-bundle.ts`. Esperado: total inicial ≤ 150 KB, com o Leaflet num chunk à parte.
- [ ] **Passo 5: commit.** Mensagem: `feat(fase 3A): marcar o ponto no mapa (Leaflet com blocos do Google)`.

---

### Tarefa 10: "Onde?" e "Confira o pedido" com rota e prévia

**Arquivos:**
- modificar `src/lib/novoPedido.ts`, `src/lib/novoPedido.test.ts` e `src/telas/pedidos/NovoPedido.tsx`;
- criar `src/telas/pedidos/PreviaOrcamento.tsx`;
- modificar `tests/e2e/enderecos.spec.ts`.

**Interfaces:**
- **Consome:** `CampoEndereco`, `FolhaMarcarNoMapa`, `rota()`, `formatarRota()` e `api.previa_orcamento`.
- **Produz:**
  - `FormPedido` ganha `origemLocal: Local | null`, `destinoLocal: Local | null`, `kmEstimado: number | null` e `minutosEstimados: number | null`;
  - `montarPedido(f)` passa a incluir as chaves da Tarefa 1 só quando há local ou km.

- [ ] **Passo 1: unidade que falha** (`novoPedido.test.ts`):
```ts
it('montarPedido inclui coordenadas e km só quando há local escolhido', () => {
  const base = { ...FORM_VAZIO, dia: '2026-10-20', inicio: '2026-10-20T10:00:00.000Z', origem: 'Porto', destino: 'Estaleiro', levar: true }
  expect(montarPedido(base)).not.toHaveProperty('origem_lat')
  const p = montarPedido({ ...base,
    origemLocal: { nome: 'Porto', endereco: 'Av. X', lat: -26.9, lng: -48.66, place_id: 'ChIJabc' },
    destinoLocal: { nome: 'Estaleiro', endereco: null, lat: -26.89, lng: -48.65, place_id: null },
    kmEstimado: 38.2, minutosEstimados: 45 })
  expect(p).toMatchObject({ origem_lat: -26.9, origem_lng: -48.66, origem_endereco: 'Av. X', origem_place_id: 'ChIJabc',
    destino_lat: -26.89, destino_lng: -48.65, km_estimado: 38.2, minutos_estimados: 45 })
  expect(p).not.toHaveProperty('destino_place_id')
  expect(p).not.toHaveProperty('destino_endereco')
})
```
- [ ] **Passo 2: e2e que falha** (acrescente em `enderecos.spec.ts`):
```ts
test('com os dois pontos: rota no Onde? e prévia no Confira (N2), com reboque Sim e Não sei', async ({ page }) => {
  // simularMapas: rota {km: 38.2, minutos: 45}; simularApi: previa_orcamento devolve linhas e total_cent 42360 (e 19950 sem reboque)
  // espera "38 km pela rota" e "cerca de 45 min"; no Confira, "Prévia do orçamento" e "R$ 423,60";
  // o aviso "Estimativa pela tabela do contrato. O valor final vem no orçamento do motorista.";
  // com reboque "Não sei": "Sem reboque R$ 199,50" e "Com reboque R$ 423,60"; o corpo do criar_pedido traz km_estimado 38.2
})
test('N3 não cria pedido; sem rota (mesmo ponto) não há prévia e o pedido segue', async ({ page }) => {
  // simularMapas({ semRota: true }); no Confira não existe "Prévia do orçamento"; "Enviar pedido" funciona
})
```
- [ ] **Passo 3: implementar.**
  - **"Onde?":** troque os `Campo` de Origem e Destino por `CampoEndereco`. Com os dois locais, chame `rota()` uma vez por par (memorizado pela dupla `place_id` ou lat/lng) e mostre a linha `.confirma` com `formatarRota`.
  - **Revisar:** a "Prévia do orçamento" (`PreviaOrcamento`) entra **abaixo do `resumo-pedido`**, só para `podeCriarPedido(perfil)` e com `kmEstimado` presente.
    - Chama `previa_orcamento` com `{km: kmEstimado, usa_reboque, levar, trazer, modalidade}`.
    - Com `reboque === 'NAO_SEI'`, chama duas vezes (com e sem reboque) e mostra dois cartões lado a lado.
    - Mostra o valor em `ivo-valor`, as linhas expansíveis ("Ver as linhas" / "Ocultar as linhas") e o aviso exato.
    - Erro ou `SEM_CONTRATO`: o bloco não aparece.
    - Usa `useConsulta` **sem `cache`**, porque é valor de dinheiro.
- [ ] **Passo 4: ver passar** a unidade e o e2e, nos dois projetos e nos dois temas, para a prévia.
- [ ] **Passo 5: commit.** Mensagem: `feat(fase 3A): rota no Onde e prévia do orçamento no Confira`.

---

### Tarefa 11: km preenchidos no "Orçar"

**Arquivos:** modificar `src/lib/orcar.ts`, `src/lib/orcar.test.ts`, `src/telas/pedidos/Orcar.tsx` e `src/lib/pedidos.ts` (tipo do detalhe), além de testes e2e em `tests/e2e/pedidos-equipe.spec.ts`.

**Interfaces:**
- **Consome:** `pedido.km_estimado` e `pedido.minutos_estimados` (Tarefa 1).
- **Produz:** `formDaEntrada(entrada, modalidade, reboque, kmEstimado?: number | null)`. Sem orçamento anterior e com `kmEstimado`, preenche `kmDecimos = Math.round(kmEstimado * 10)`.

- [ ] **Passo 1: unidade que falha:**
```ts
it('sem orçamento anterior, usa os km estimados pela rota', () => {
  expect(formDaEntrada(null, 'VEICULO_PROPRIO', 'SIM', 38.2).kmDecimos).toBe(382)
  expect(formDaEntrada(null, 'VEICULO_PROPRIO', 'SIM', null).kmDecimos).toBe(0)
  expect(formDaEntrada({ km: 40 }, 'VEICULO_PROPRIO', 'SIM', 38.2).kmDecimos).toBe(400) // revisão: vale o anterior
})
```
- [ ] **Passo 2: e2e que falha:** com `pedidoSolicitadoMotorista({ km_estimado: 38.2, minutos_estimados: 45 })`, o campo "Quilometragem" vale `38,2` e aparece "Estimado pela rota: 38 km, cerca de 45 min. Confira.". Sem `km_estimado`, o campo fica vazio, sem o aviso, e nada quebra.
- [ ] **Passo 3: implementar** em `Orcar.tsx:83`: passe `p.km_estimado` a `formDaEntrada`. Abaixo do campo, mostre o aviso com `MarcaAgora` e `text-alerta-texto` quando `p.km_estimado` existe e não há orçamento anterior.
- [ ] **Passo 4: ver passar.**
- [ ] **Passo 5: commit.** Mensagem: `feat(fase 3A): orçar já vem com os km estimados pela rota`.

---

### Tarefa 12: fluxo real, roteiro do dono e verificação final

**Arquivos:**
- modificar `tests/e2e/real/pedidos.spec.ts`;
- criar `docs/fases/fase-3a-o-que-testar.md`;
- modificar `docs/RUNBOOK.md`, `HANDOFF.md` e `tests/e2e/zz-capturas-redesign.spec.ts`.

- [ ] **Passo 1: fluxo real (CI).** Sem chave do Google, o campo cai no texto livre. Acrescente ao fluxo 2A uma checagem: com o aviso "Não foi possível buscar endereços agora…", o pedido é criado normalmente. A prévia e as coordenadas já ficam cobertas pela integração (Tarefa 3) e pelos e2e simulados.
- [ ] **Passo 2: capturas.** Acrescente a `zz-capturas-redesign.spec.ts` as telas "Onde?" com a lista, "Marcar no mapa", "Confira" com a prévia e "Orçar" com os km, nos modos claro e escuro.
- [ ] **Passo 3: RUNBOOK §Google Maps.** Escreva o passo a passo do dono:
  1. Criar o projeto no Google Cloud.
  2. Ativar o faturamento e o alerta de orçamento (R$ 50).
  3. Ativar Places API (New), Routes API e Map Tiles API.
  4. Criar a chave de servidor (restrição: Places New e Routes) e guardá-la em GitHub → Settings → Environments → producao → Secrets → `GOOGLE_MAPS_CHAVE_SERVIDOR`.
  5. Criar a chave de navegador (restrições: Map Tiles API e referenciadores `https://umi-san-transporte.pages.dev/*`) e guardá-la em Environments → producao → Variables → `VITE_GOOGLE_MAPS_CHAVE_NAVEGADOR`.
  6. Para trocar uma chave vazada: criar uma nova, atualizar o segredo, rodar o Deploy e apagar a antiga.
- [ ] **Passo 4: `fase-3a-o-que-testar.md`.** Roteiro de 10 passos no celular, no padrão de `fase-2a-o-que-testar.md`: buscar um porto, um local da empresa, marcar uma marina no mapa, conferir os km e o tempo, a prévia com reboque Sim e Não sei, o N3 sem prévia, o motorista com os km preenchidos e o Google fora do ar (chave removida).
- [ ] **Passo 5: suíte completa local:**
  ```bash
  npm run lint && npm run typecheck && npm run test:unit && npm run build:test && npx playwright test
  ```
  Depois, push e CI verde: pgTAP, integração e e2e real.
- [ ] **Passo 6: revisão final da branch** por um revisor independente, no modelo mais capaz. Depois, PR para `main` **sem merge**, com as capturas e o passo a passo do Google. O merge é do dono.
