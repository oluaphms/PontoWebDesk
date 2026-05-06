-- Marcação visual de dias revisados na auditoria de jornada (não altera motor nem batidas).

CREATE TABLE IF NOT EXISTS public.time_attendance_audit_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  date DATE NOT NULL,
  reviewed_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_time_attendance_audit_reviews_company_date
  ON public.time_attendance_audit_reviews (company_id, date DESC);

ALTER TABLE public.time_attendance_audit_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_attendance_audit_reviews_select" ON public.time_attendance_audit_reviews;
CREATE POLICY "time_attendance_audit_reviews_select"
  ON public.time_attendance_audit_reviews FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "time_attendance_audit_reviews_insert" ON public.time_attendance_audit_reviews;
CREATE POLICY "time_attendance_audit_reviews_insert"
  ON public.time_attendance_audit_reviews FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

DROP POLICY IF EXISTS "time_attendance_audit_reviews_update" ON public.time_attendance_audit_reviews;
CREATE POLICY "time_attendance_audit_reviews_update"
  ON public.time_attendance_audit_reviews FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

COMMENT ON TABLE public.time_attendance_audit_reviews IS 'RH marcou dia como revisado na tela de auditoria (metadado apenas)';

GRANT SELECT, INSERT, UPDATE ON public.time_attendance_audit_reviews TO authenticated;
GRANT ALL ON public.time_attendance_audit_reviews TO service_role;
