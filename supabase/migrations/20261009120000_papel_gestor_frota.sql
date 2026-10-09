-- Fase 1B (Adendo A10): papel GESTOR_FROTA no lado do prestador.
-- Arquivo separado: ALTER TYPE ... ADD VALUE não pode ser usado na mesma transação que o valor novo.
alter type app.papel add value if not exists 'GESTOR_FROTA';
