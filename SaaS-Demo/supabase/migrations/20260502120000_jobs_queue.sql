-- Fila de jobs assíncronos (cálculo de período, dia, reconstrução de banco).
-- Service role (API server) insere/lê com bypass; app autenticado lê via RLS por company.

CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON public.jobs (status, created_at);

COMMENT ON TABLE public.jobs IS 'Fila de processamento assíncrono (CALC_DAY, CALC_PERIOD, REBUILD_BANK).';

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- Leitura: mesmo company do utilizador autenticado (users.id = auth.uid())
DROP POLICY IF EXISTS jobs_select_company ON public.jobs;
CREATE POLICY jobs_select_company ON public.jobs
  FOR SELECT TO authenticated
  USING (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );
