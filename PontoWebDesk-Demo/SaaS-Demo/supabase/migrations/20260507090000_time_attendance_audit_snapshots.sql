-- Snapshots diários de KPIs da auditoria de jornada (histórico / tendência).
-- company_id TEXT alinha a timesheets_daily e users.company_id.

CREATE TABLE IF NOT EXISTS public.time_attendance_audit_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  inconsistent_count INTEGER NOT NULL,
  duplicate_count INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  affected_users INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_time_attendance_audit_snapshots_company_date
  ON public.time_attendance_audit_snapshots (company_id, snapshot_date DESC);

ALTER TABLE public.time_attendance_audit_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_attendance_audit_snapshots_company_select" ON public.time_attendance_audit_snapshots;
CREATE POLICY "time_attendance_audit_snapshots_company_select"
  ON public.time_attendance_audit_snapshots FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "time_attendance_audit_snapshots_company_write" ON public.time_attendance_audit_snapshots;
CREATE POLICY "time_attendance_audit_snapshots_company_write"
  ON public.time_attendance_audit_snapshots FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

DROP POLICY IF EXISTS "time_attendance_audit_snapshots_company_update" ON public.time_attendance_audit_snapshots;
CREATE POLICY "time_attendance_audit_snapshots_company_update"
  ON public.time_attendance_audit_snapshots FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

COMMENT ON TABLE public.time_attendance_audit_snapshots IS 'KPIs diários da auditoria de jornada (1 linha por empresa por dia civil)';

GRANT SELECT, INSERT, UPDATE ON public.time_attendance_audit_snapshots TO authenticated;
GRANT ALL ON public.time_attendance_audit_snapshots TO service_role;
