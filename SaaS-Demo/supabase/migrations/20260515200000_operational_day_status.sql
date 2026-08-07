-- Status operacional consolidado por colaborador/dia (espelho + REP pendente + reconciliação TS).

CREATE TABLE IF NOT EXISTS public.operational_day_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- TEXT alinha a public.users.company_id (UUID em muitos ambientes, coluna ainda é text).
  company_id text NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,

  date date NOT NULL,

  status text NOT NULL CHECK (status IN (
    'ok',
    'incomplete',
    'inconsistent',
    'pending_rep',
    'error'
  )),

  total_records int NOT NULL DEFAULT 0,
  total_rep_pending int NOT NULL DEFAULT 0,

  issues jsonb NOT NULL DEFAULT '[]'::jsonb,

  first_punch timestamptz,
  last_punch timestamptz,

  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (company_id, employee_id, date)
);

COMMENT ON TABLE public.operational_day_status IS
  'Consolidação diária: batidas no espelho, pendências REP e resultado da reconciliação operacional (TS).';

CREATE INDEX IF NOT EXISTS idx_operational_day_company_date
  ON public.operational_day_status (company_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_operational_day_employee
  ON public.operational_day_status (employee_id, date DESC);

ALTER TABLE public.operational_day_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_isolation_select" ON public.operational_day_status;
CREATE POLICY "tenant_isolation_select"
ON public.operational_day_status
FOR SELECT
TO authenticated
USING (
  company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()) LIMIT 1)
);

DROP POLICY IF EXISTS "tenant_isolation_insert" ON public.operational_day_status;
CREATE POLICY "tenant_isolation_insert"
ON public.operational_day_status
FOR INSERT
TO authenticated
WITH CHECK (
  company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()) LIMIT 1)
);

DROP POLICY IF EXISTS "tenant_isolation_update" ON public.operational_day_status;
CREATE POLICY "tenant_isolation_update"
ON public.operational_day_status
FOR UPDATE
TO authenticated
USING (
  company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()) LIMIT 1)
)
WITH CHECK (
  company_id = (SELECT u.company_id FROM public.users u WHERE u.id = (SELECT auth.uid()) LIMIT 1)
);

GRANT SELECT, INSERT, UPDATE ON public.operational_day_status TO authenticated;
GRANT ALL ON public.operational_day_status TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_operational_day_status(
  p_company_id text,
  p_employee_id uuid,
  p_date date,
  p_status text,
  p_total_records int,
  p_total_rep_pending int,
  p_issues jsonb,
  p_first_punch timestamptz,
  p_last_punch timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.operational_day_status (
    company_id,
    employee_id,
    date,
    status,
    total_records,
    total_rep_pending,
    issues,
    first_punch,
    last_punch,
    updated_at
  )
  VALUES (
    p_company_id,
    p_employee_id,
    p_date,
    p_status,
    p_total_records,
    p_total_rep_pending,
    p_issues,
    p_first_punch,
    p_last_punch,
    now()
  )
  ON CONFLICT (company_id, employee_id, date)
  DO UPDATE SET
    status = EXCLUDED.status,
    total_records = EXCLUDED.total_records,
    total_rep_pending = EXCLUDED.total_rep_pending,
    issues = EXCLUDED.issues,
    first_punch = EXCLUDED.first_punch,
    last_punch = EXCLUDED.last_punch,
    updated_at = now();
END;
$$;

COMMENT ON FUNCTION public.upsert_operational_day_status IS
  'Idempotente: grava ou atualiza o snapshot operacional do colaborador no dia (invoker RLS).';

GRANT EXECUTE ON FUNCTION public.upsert_operational_day_status(
  text, uuid, date, text, int, int, jsonb, timestamptz, timestamptz
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_operational_day_status(
  text, uuid, date, text, int, int, jsonb, timestamptz, timestamptz
) TO service_role;
