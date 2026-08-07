-- Escalabilidade SaaS multi-tenant: índices compostos aditivos (IF NOT EXISTS).
-- Não altera regras de negócio nem contratos de API.

-- Jornada / espelho: filtro por empresa + intervalo de datas
CREATE INDEX IF NOT EXISTS idx_timesheets_daily_company_date
  ON public.timesheets_daily (company_id, date);

-- Batidas: listagens de período por empresa (sem user_id)
CREATE INDEX IF NOT EXISTS idx_time_records_company_timestamp
  ON public.time_records (company_id, timestamp DESC NULLS LAST);

-- Fila de jobs: isolamento por tenant
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'jobs'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'company_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_jobs_company_status_type_created
      ON public.jobs (company_id, status, type, created_at);
  END IF;
END $$;

-- RH: lista de colaboradores ativos por empresa
CREATE INDEX IF NOT EXISTS idx_employees_company_active_created
  ON public.employees (company_id, created_at DESC)
  WHERE coalesce(status, 'active') = 'active';

-- REP pending promote (confirmação se migração anterior falhou)
CREATE INDEX IF NOT EXISTS idx_rep_punch_logs_pending_promote_company
  ON public.rep_punch_logs (company_id, data_hora)
  WHERE time_record_id IS NULL
    AND resolved_user_id IS NOT NULL
    AND coalesce(ignored, false) = false;
