-- Migration 20261026120000_criar_pedido_trava_agenda.sql: api.criar_pedido trava a agenda do motorista
-- (pg_advisory_xact_lock) antes de expirar pré-reservas e gravar o bloco. Assim pedidos simultâneos no mesmo horário
-- recebem HORARIO_OCUPADO, e não um deadlock na restrição de exclusão. A concorrência real fica no teste de integração
-- (tests/integracao/pedidos.test.ts, "dois clientes (quatro requisições)").
begin;
select plan(2);

select ok((select prosrc from pg_proc where oid = 'api.criar_pedido(jsonb)'::regprocedure)
            ~ 'pg_advisory_xact_lock\(hashtext\(''agenda:'' \|\| v_motorista::text\)\)',
  'criar_pedido trava a agenda do motorista');
select ok(strpos((select prosrc from pg_proc where oid = 'api.criar_pedido(jsonb)'::regprocedure), 'pg_advisory_xact_lock')
          < strpos((select prosrc from pg_proc where oid = 'api.criar_pedido(jsonb)'::regprocedure), 'insert into app.agenda_blocos'),
  'a trava vem antes de gravar o bloco da agenda');

select * from finish();
rollback;
