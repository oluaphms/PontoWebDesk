-- Timeline operacional auditável (observabilidade; não altera motor nem batidas).

CREATE TABLE IF NOT EXISTS public.time_attendance_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  employee_id TEXT NULL,
  date DATE NULL,
  event_type TEXT NOT NULL,
  event_severity TEXT NOT NULL DEFAULT 'info',
  source_module TEXT NULL,
  source_reference_id TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_attendance_timeline_company_emp_date
  ON public.time_attendance_timeline (company_id, employee_id, date);

CREATE INDEX IF NOT EXISTS idx_time_attendance_timeline_company_created
  ON public.time_attendance_timeline (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_attendance_timeline_event_type
  ON public.time_attendance_timeline (event_type);

COMMENT ON TABLE public.time_attendance_timeline IS 'Eventos operacionais do ciclo de ponto (REP, motor, fechamento, incidentes) — apenas observabilidade.';

ALTER TABLE public.time_attendance_timeline ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_attendance_timeline_select" ON public.time_attendance_timeline;
CREATE POLICY "time_attendance_timeline_select"
  ON public.time_attendance_timeline FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "time_attendance_timeline_insert" ON public.time_attendance_timeline;
CREATE POLICY "time_attendance_timeline_insert"
  ON public.time_attendance_timeline FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

GRANT SELECT, INSERT ON public.time_attendance_timeline TO authenticated;
GRANT ALL ON public.time_attendance_timeline TO service_role;
