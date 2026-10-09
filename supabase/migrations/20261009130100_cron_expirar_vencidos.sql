-- Fase 2A (especificação §5): o cron só expira o restante a cada 15 min; quem ocupa um horário já expira,
-- na mesma transação, as pré-reservas vencidas que colidem, e toda ação checa o prazo com now().
-- pg_cron como recomendado pelo Supabase (schema pg_catalog; os objetos ficam no schema cron).
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- Idempotente: cron.schedule com nome substitui o job de mesmo nome.
select cron.schedule('expirar-vencidos', '*/15 * * * *', 'select interno.expirar_vencidos()');
