-- Resolução explícita de incidentes operacionais (metadado; não altera motor).

CREATE TABLE IF NOT EXISTS public.time_attendance_incident_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  incident_code TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  date DATE NOT NULL,
  resolved_by TEXT NOT NULL,
  resolution_note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, date, incident_code)
);

CREATE INDEX IF NOT EXISTS idx_time_attendance_incident_reviews_company_date
  ON public.time_attendance_incident_reviews (company_id, date DESC);

ALTER TABLE public.time_attendance_incident_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_attendance_incident_reviews_select" ON public.time_attendance_incident_reviews;
CREATE POLICY "time_attendance_incident_reviews_select"
  ON public.time_attendance_incident_reviews FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "time_attendance_incident_reviews_insert" ON public.time_attendance_incident_reviews;
CREATE POLICY "time_attendance_incident_reviews_insert"
  ON public.time_attendance_incident_reviews FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

DROP POLICY IF EXISTS "time_attendance_incident_reviews_delete" ON public.time_attendance_incident_reviews;
CREATE POLICY "time_attendance_incident_reviews_delete"
  ON public.time_attendance_incident_reviews FOR DELETE TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

COMMENT ON TABLE public.time_attendance_incident_reviews IS 'RH marcou incidente operacional como resolvido (central de incidentes).';

GRANT SELECT, INSERT, DELETE ON public.time_attendance_incident_reviews TO authenticated;
GRANT ALL ON public.time_attendance_incident_reviews TO service_role;
