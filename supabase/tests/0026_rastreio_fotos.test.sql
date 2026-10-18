-- Fase 3B, Tarefa 2 (migration 20261018120100_rastreio_fotos.sql): envio de posição (só o motorista da viagem em
-- andamento, validação, gravação a cada ~200 m), limite de 12 cálculos de chegada, quem assina rastreio:<id>, km rodados
-- e posições apagadas na conclusão, fotos (autorizar, confirmar só com o arquivo no bucket, até 10, janela de 24 h,
-- leitura só para quem vê o pedido) e as ações novas de api.pedido.
-- Entrega real pelo canal: tests/integracao/execucao.test.ts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

insert into app.empresas (id, nome) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa A');
insert into app.convites (email, nome, papel, empresa_id, nivel) values
  ('adm@teste.local',  'Admin Teste',     'ADM',          null, null),
  ('mot@teste.local',  'Motorista Teste', 'MOTORISTA',    null, null),
  ('ges@teste.local',  'Gestor Frota',    'GESTOR_FROTA', null, null),
  ('n1a@teste.local',  'Gestora A',       'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 1),
  ('n2a@teste.local',  'Solicitante A',   'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2),
  ('n3a@teste.local',  'Visualizador A',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 3),
  ('n2a2@teste.local', 'Solicitante A2',  'CLIENTE', '00000000-0000-0000-0000-0000000000e1', 2);
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm@teste.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mot@teste.local'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ges@teste.local'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n1a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n3a@teste.local'),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n2a2@teste.local');
update app.perfis set senha_pendente = false;

select interno.inserir_contrato('00000000-0000-0000-0000-0000000000e1', '{
  "km_sem_reboque_cent": 250, "km_com_reboque_cent": 350, "taxa_fixa_reboque_cent": 15000,
  "retorno_trecho_unico_bp": 5000, "hora_espera_cent": 5000, "hospedagem_diaria_cent": 18000,
  "diaria_motorista_cent": 30000,
  "faixas_cancelamento": [{"antecedencia_min_horas": 48, "multa_bp": 0}, {"antecedencia_min_horas": 0, "multa_bp": 10000}],
  "prazo_orcar_horas": 12, "validade_orcamento_horas": 24, "limiar_urgente_horas": 6,
  "limite_saldo_negativo_cent": 50000, "alerta_saldo_baixo_cent": 20000}'::jsonb, now() - interval '1 hour', null, 'Teste');
select set_config('t.c' || u, json_build_object('sub', '00000000-0000-0000-0000-0000000000' || u, 'role', 'authenticated',
                                                 'aal', case when u in ('a1', 'a2', 'a3') then 'aal2' else 'aal1' end)::text, true)
from unnest(array['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']) u;

-- s1 sai (em andamento); s2 fica AGENDADA.
create temp table casos (nome text primary key, atraso interval) on commit drop;
insert into casos values ('s1', '10 minutes'), ('s2', '5 hours');
do $$
declare
  x record;
begin
  perform set_config('request.jwt.claims', current_setting('t.ca5'), true);
  for x in select * from casos order by nome loop
    perform set_config('t.' || x.nome, api.criar_pedido(jsonb_build_object(
      'duracao_min', 60, 'origem', 'Porto de Itajaí', 'destino', 'Base Navegantes', 'levar', true, 'trazer', false,
      'carga', 'PESSOAS', 'pessoas_qtd', 1, 'modalidade', 'VEICULO_PROPRIO', 'reboque', 'NAO',
      'inicio', to_char((now() + x.atraso) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) ->> 'id', true);
  end loop;
  perform set_config('request.jwt.claims', current_setting('t.ca2'), true);
  for x in select * from casos order by nome loop
    perform api.enviar_orcamento(current_setting('t.' || x.nome)::uuid, jsonb_build_object('pedagio_cent', 5000), null);
  end loop;
  perform set_config('request.jwt.claims', current_setting('t.ca1'), true);
  perform api.lancar_recarga('00000000-0000-0000-0000-0000000000e1', 100000, 'Pix inicial', null, gen_random_uuid());
  perform set_config('request.jwt.claims', current_setting('t.ca5'), true);
  for x in select c.nome, o.versao, o.hash from casos c
             join app.orcamentos o on o.atividade_id = current_setting('t.' || c.nome)::uuid and o.status = 'PENDENTE'
            order by c.nome loop
    perform api.aprovar_orcamento(current_setting('t.' || x.nome)::uuid, x.versao, x.hash, gen_random_uuid(), null);
  end loop;
  perform set_config('request.jwt.claims', current_setting('t.ca2'), true);
  perform api.registrar_saida(current_setting('t.s1')::uuid, gen_random_uuid());
end $$;
select is((select status::text from app.atividades where id = current_setting('t.s1')::uuid), 'EM_ANDAMENTO', 's1 em andamento');

------------------------------------------------------------------ 1. ações e campos de api.pedido
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select ok((api.pedido(current_setting('t.s2')::uuid) #>> '{acoes,sair}')::boolean, 'motorista: sair em AGENDADA');
select ok((api.pedido(current_setting('t.s1')::uuid) #>> '{acoes,concluir}')::boolean
          and (api.pedido(current_setting('t.s1')::uuid) #>> '{acoes,informar_previsao}')::boolean
          and (api.pedido(current_setting('t.s1')::uuid) #>> '{acoes,enviar_fotos}')::boolean,
  'motorista: concluir, previsão e fotos em andamento');
select ok((api.pedido(current_setting('t.s1')::uuid) #>> '{pedido,saiu_em}') is not null, 'detalhe com saiu_em');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select ok(not (api.pedido(current_setting('t.s2')::uuid) #>> '{acoes,sair}')::boolean, 'cliente: sem sair');
select ok((api.pedido(current_setting('t.s1')::uuid) #>> '{pedido,pode_ver_rastreio}')::boolean, 'solicitante vê o rastreio');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select ok(not (api.pedido(current_setting('t.s1')::uuid) #>> '{pedido,pode_ver_rastreio}')::boolean, 'N3 não vê o rastreio');

------------------------------------------------------------------ 2. enviar posição
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.enviar_posicao(current_setting('t.s1')::uuid, '{"lat": -26.9, "lng": -48.66}') ->> 'codigo', 'SEM_PERMISSAO',
  'cliente não envia posição');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select is(api.enviar_posicao(current_setting('t.s1')::uuid, '{"lat": -26.9, "lng": -48.66}') ->> 'codigo', 'SEM_PERMISSAO',
  'ADM não envia posição');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.enviar_posicao(current_setting('t.s2')::uuid, '{"lat": -26.9, "lng": -48.66}') ->> 'codigo', 'STATUS_INVALIDO',
  'pedido que não saiu: STATUS_INVALIDO');
select is(api.enviar_posicao(current_setting('t.s1')::uuid, '{"lat": 91, "lng": -48.66}') ->> 'codigo', 'CAMPOS_INVALIDOS',
  'latitude inválida');
select is(api.enviar_posicao(current_setting('t.s1')::uuid, '{"lat": "-26.9", "lng": -48.66}') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'latitude como texto');
select is(api.enviar_posicao(current_setting('t.s1')::uuid, '{"lat": -26.9, "lng": -48.66, "precisao": 150}') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'precisão pior que 100 m');
select is(api.enviar_posicao(current_setting('t.s1')::uuid, '{"lat": -26.9, "lng": -48.66, "seq": 1.5}') ->> 'codigo',
  'CAMPOS_INVALIDOS', 'seq não inteiro');
select is(api.enviar_posicao(current_setting('t.s1')::uuid,
  '{"lat": -26.9, "lng": -48.66, "precisao": 12, "rumo": 90, "velocidade": 11.5, "seq": 1}') ->> 'ok', 'true',
  'motorista envia posição');
select is(api.enviar_posicao(current_setting('t.s1')::uuid, '{"lat": -26.9001, "lng": -48.66, "seq": 2}') ->> 'ok', 'true',
  'posição perto da anterior: aceita');
select is(api.enviar_posicao(current_setting('t.s1')::uuid,
  '{"lat": -26.897, "lng": -48.66, "seq": 3, "eta": "2099-01-01T00:00:00Z"}') ->> 'ok', 'true',
  'posição a ~330 m: aceita (eta absurda é ignorada)');
reset role;
select is((select count(*)::int from app.posicoes where atividade_id = current_setting('t.s1')::uuid), 2,
  'grava só a cada ~200 m (ou 30 s): 2 de 3');
select is((select count(*)::int from app.auditoria where acao = 'ENVIAR_POSICAO' and resultado = 'OK'), 0,
  'sucesso do envio não é auditado');
select ok((select count(*) from app.auditoria where acao = 'ENVIAR_POSICAO' and codigo = 'CAMPOS_INVALIDOS') >= 4,
  'negações do envio são auditadas');
select is(interno.km_das_posicoes(current_setting('t.s1')::uuid), 0.3, 'km pelas posições gravadas');

------------------------------------------------------------------ 3. cálculos de chegada (12 por viagem)
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is((api.registrar_eta(current_setting('t.s1')::uuid) ->> 'restantes')::int, 11, 'primeiro cálculo: restam 11');
select is((select count(*)::int from generate_series(1, 11) i
            where api.registrar_eta(current_setting('t.s1')::uuid) ->> 'ok' = 'true'), 11, 'mais 11 cálculos aceitos');
select is(api.registrar_eta(current_setting('t.s1')::uuid) ->> 'codigo', 'LIMITE_ETA', '13º cálculo: LIMITE_ETA');
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.registrar_eta(current_setting('t.s1')::uuid) ->> 'codigo', 'SEM_PERMISSAO', 'cliente não registra ETA');

------------------------------------------------------------------ 4. quem assina rastreio:<id>
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select ok(app.pode_ver_topico('rastreio:' || current_setting('t.s1')), 'solicitante assina o rastreio');
select set_config('request.jwt.claims', current_setting('t.ca4'), true);
select ok(app.pode_ver_topico('rastreio:' || current_setting('t.s1')), 'N1 assina o rastreio');
select set_config('request.jwt.claims', current_setting('t.ca3'), true);
select ok(app.pode_ver_topico('rastreio:' || current_setting('t.s1')), 'gestor de frota assina o rastreio');
select set_config('request.jwt.claims', current_setting('t.ca1'), true);
select ok(app.pode_ver_topico('rastreio:' || current_setting('t.s1')), 'ADM assina o rastreio');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select ok(not app.pode_ver_topico('rastreio:' || current_setting('t.s1')), 'N3 não assina o rastreio');
select ok(app.pode_ver_topico('atividade:' || current_setting('t.s1')), 'N3 continua vendo o status');
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select ok(not app.pode_ver_topico('rastreio:' || current_setting('t.s1')), 'outro N2 não assina o rastreio');
select ok(not app.pode_ver_topico('rastreio:nao-e-uuid'), 'tópico malformado recusado');

------------------------------------------------------------------ 5. fotos
select set_config('request.jwt.claims', current_setting('t.ca5'), true);
select is(api.autorizar_foto(current_setting('t.s1')::uuid, 'image/jpeg', 1000) ->> 'codigo', 'SEM_PERMISSAO',
  'cliente não envia foto');
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.autorizar_foto(current_setting('t.s1')::uuid, 'image/gif', 1000) ->> 'codigo', 'FOTO_INVALIDA', 'GIF recusado');
select is(api.autorizar_foto(current_setting('t.s1')::uuid, 'image/jpeg', 5242881) ->> 'codigo', 'FOTO_INVALIDA',
  'acima de 5 MB recusado');
select is(api.autorizar_foto(current_setting('t.s2')::uuid, 'image/jpeg', 1000) ->> 'codigo', 'STATUS_INVALIDO',
  'pedido que não saiu: STATUS_INVALIDO');
select set_config('t.f1', api.autorizar_foto(current_setting('t.s1')::uuid, 'image/webp', 300000)::text, true);
select ok(current_setting('t.f1')::jsonb ->> 'caminho' ~ ('^' || current_setting('t.s1') || '/[0-9a-f-]{36}\.webp$'),
  'caminho <pedido>/<uuid>.webp');
select is(api.confirmar_foto((current_setting('t.f1')::jsonb ->> 'foto_id')::uuid) ->> 'codigo', 'FOTO_INVALIDA',
  'confirmar sem o arquivo no bucket: FOTO_INVALIDA');
reset role;
insert into storage.objects (bucket_id, name) values ('fotos', current_setting('t.f1')::jsonb ->> 'caminho');
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.confirmar_foto((current_setting('t.f1')::jsonb ->> 'foto_id')::uuid) ->> 'ok', 'true', 'confirmar com o arquivo');
select is((select count(*)::int from generate_series(1, 9) i
            where api.autorizar_foto(current_setting('t.s1')::uuid, 'image/jpeg', 1000) ->> 'ok' = 'true'), 9,
  'mais 9 autorizações (10 no total)');
select is(api.autorizar_foto(current_setting('t.s1')::uuid, 'image/jpeg', 1000) ->> 'codigo', 'LIMITE_FOTOS',
  '11ª foto: LIMITE_FOTOS');
select set_config('request.jwt.claims', current_setting('t.ca6'), true);
select is(jsonb_array_length(api.fotos_do_pedido(current_setting('t.s1')::uuid) -> 'fotos'), 1,
  'quem vê o pedido (N3) lista só as fotos confirmadas');
select ok(app.pode_ver_foto(current_setting('t.f1')::jsonb ->> 'caminho'), 'N3 lê a foto confirmada');
select set_config('request.jwt.claims', current_setting('t.ca7'), true);
select ok(not app.pode_ver_foto(current_setting('t.f1')::jsonb ->> 'caminho'), 'outro N2 não lê a foto');
select is(api.fotos_do_pedido(current_setting('t.s1')::uuid) ->> 'codigo', 'NAO_ENCONTRADO', 'outro N2 não lista as fotos');

------------------------------------------------------------------ 6. conclusão: km e posições apagadas
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is((api.concluir(current_setting('t.s1')::uuid, null) ->> 'km_rodados')::numeric, 0.3, 'conclusão devolve o km rodados');
reset role;
select is((select count(*)::int from app.posicoes where atividade_id = current_setting('t.s1')::uuid), 0,
  'posições apagadas na conclusão');
update app.atividades set concluiu_em = now() - interval '25 hours' where id = current_setting('t.s1')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', current_setting('t.ca2'), true);
select is(api.enviar_posicao(current_setting('t.s1')::uuid, '{"lat": -26.9, "lng": -48.66}') ->> 'codigo', 'STATUS_INVALIDO',
  'depois de concluir, nenhuma posição é aceita');
reset role;

select * from finish();
rollback;
