-- Cleanup anti-custo: mantém apenas 7 dias de logs brutos de REP.
DELETE FROM rep_punch_logs
WHERE created_at < NOW() - INTERVAL '7 days';
-- IMPORTANTE: `time_records` é trilha legal de ponto (Portaria 671).
-- A tabela possui proteção contra UPDATE/DELETE e não pode ser limpa por retenção.
