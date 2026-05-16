-- Alertas operacionais automáticos (jornada, REP, inconsistências).
-- company_id TEXT alinha a public.users.company_id.

CREATE TABLE IF NOT EXISTS public.operational_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id text NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,

  date date NOT NULL,

  alert_type text NOT NULL CHECK (alert_type IN (
    'missing_exit',
    'long_break',
    'excess_hours',
    'inconsistency',
    'rep_pending_stale'
  )),

  severity text NOT NULL CHECK (severity IN (
    'low',
    'medium',
    'high',
    'critical'
  )),

  message text NOT NULL,

  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.operational_alerts IS
  'Alertas derivados de espelho, REP pendente e operational_day_status; base para notificações.';

CREATE INDEX IF NOT EXISTS idx_operational_alerts_company
  ON public.operational_alerts (company_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_operational_alerts_employee
  ON public.operational_alerts (employee_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_operational_alerts_unresolved
  ON public.operational_alerts (company_id)
  WHERE resolved = false;

ALTER TABLE public.operational_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "alerts_select" ON public.operational_alerts;
CREATE POLICY "alerts_select"
  ON public.operational_alerts FOR SELECT TO authenticated
  USING (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "alerts_insert" ON public.operational_alerts;
CREATE POLICY "alerts_insert"
  ON public.operational_alerts FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "alerts_update" ON public.operational_alerts;
CREATE POLICY "alerts_update"
  ON public.operational_alerts FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  )
  WITH CHECK (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "alerts_delete" ON public.operational_alerts;
CREATE POLICY "alerts_delete"
  ON public.operational_alerts FOR DELETE TO authenticated
  USING (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operational_alerts TO authenticated;
GRANT ALL ON public.operational_alerts TO service_role;
