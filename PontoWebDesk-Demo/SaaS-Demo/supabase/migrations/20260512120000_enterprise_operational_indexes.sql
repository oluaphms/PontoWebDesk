-- Índices adicionais para produção multi-tenant: COS, live GEO, consultas por janela.
-- Não altera RLS nem regras de negócio.

CREATE INDEX IF NOT EXISTS idx_current_operational_state_company_updated
  ON public.current_operational_state(company_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_current_operational_state_company_online
  ON public.current_operational_state(company_id)
  WHERE is_online = true;

CREATE INDEX IF NOT EXISTS idx_current_operational_state_company_map_present
  ON public.current_operational_state(company_id)
  WHERE map_latitude IS NOT NULL AND map_longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_live_employee_location_company_captured
  ON public.live_employee_location(company_id, captured_at DESC);

COMMENT ON INDEX public.idx_current_operational_state_company_updated IS
  'Painéis / monitoramento: lista por empresa ordenada por frescor do snapshot.';

COMMENT ON INDEX public.idx_live_employee_location_company_captured IS
  'Auditoria de frescor de posições realtime por empresa.';

-- ---------------------------------------------------------------------------
-- Staging / homologação: após APPLY + ANALYZE, validar planos com:
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM public.current_operational_state
--   WHERE company_id = '<tenant>'
--   ORDER BY updated_at DESC
--   LIMIT 200;
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM public.live_employee_location
--   WHERE company_id = '<tenant>'
--     AND expires_at > now();
-- ---------------------------------------------------------------------------
