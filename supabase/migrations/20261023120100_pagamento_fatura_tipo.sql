-- v2.1, Tarefa 2 (docs/fases/v2-1-ajustes-faturamento-nf-desenho.md §4.3): tipo novo de lançamento PAGAMENTO_FATURA,
-- o crédito que quita uma fatura (efeito só no contábil, como a RECARGA). Fica sozinho nesta migration: um valor novo de
-- enum não pode ser usado na mesma transação em que foi criado; quem o usa é 20261023120200_faturas.sql.
alter type app.tipo_lancamento add value if not exists 'PAGAMENTO_FATURA';
