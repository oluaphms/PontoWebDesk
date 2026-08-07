-- Dead-letter operacional: commits transacionais parciais / falhas coordenadas (sem alterar motor).

CREATE TABLE IF NOT EXISTS public.operational_dead_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  failed_stage TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_count INT NOT NULL DEFAULT 0,
  retryable BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'retrying', 'recovered', 'failed', 'ignored')),
  last_error TEXT NULL,
  next_retry_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recovered_at TIMESTAMPTZ NULL,
  CONSTRAINT operational_dead_letters_company_operation UNIQUE (company_id, operation_id)
);

CREATE INDEX IF NOT EXISTS idx_operational_dead_letters_company_status
  ON public.operational_dead_letters (company_id, status);

CREATE INDEX IF NOT EXISTS idx_operational_dead_letters_next_retry
  ON public.operational_dead_letters (company_id, next_retry_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.operational_dead_letters IS 'Fila de recuperação operacional (DLQ): falhas de commit transacional e replay idempotente.';

ALTER TABLE public.operational_dead_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operational_dead_letters_select" ON public.operational_dead_letters;
CREATE POLICY "operational_dead_letters_select"
  ON public.operational_dead_letters FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "operational_dead_letters_insert" ON public.operational_dead_letters;
CREATE POLICY "operational_dead_letters_insert"
  ON public.operational_dead_letters FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

DROP POLICY IF EXISTS "operational_dead_letters_update" ON public.operational_dead_letters;
CREATE POLICY "operational_dead_letters_update"
  ON public.operational_dead_letters FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  )
  WITH CHECK (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

GRANT SELECT, INSERT, UPDATE ON public.operational_dead_letters TO authenticated;
GRANT ALL ON public.operational_dead_letters TO service_role;
