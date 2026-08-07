-- Snapshots heurísticos de confiabilidade (sem ML; agregados leves).

CREATE TABLE IF NOT EXISTS public.time_attendance_reliability_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL DEFAULT '',
  score NUMERIC NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, snapshot_date, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_time_attendance_reliability_company_date
  ON public.time_attendance_reliability_snapshots (company_id, snapshot_date DESC);

COMMENT ON TABLE public.time_attendance_reliability_snapshots IS 'Score 0–100 e métricas compactas por empresa/dia/colaborador/ativo (determinístico).';

ALTER TABLE public.time_attendance_reliability_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_attendance_reliability_snapshots_select" ON public.time_attendance_reliability_snapshots;
CREATE POLICY "time_attendance_reliability_snapshots_select"
  ON public.time_attendance_reliability_snapshots FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "time_attendance_reliability_snapshots_insert" ON public.time_attendance_reliability_snapshots;
CREATE POLICY "time_attendance_reliability_snapshots_insert"
  ON public.time_attendance_reliability_snapshots FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

GRANT SELECT, INSERT ON public.time_attendance_reliability_snapshots TO authenticated;
GRANT ALL ON public.time_attendance_reliability_snapshots TO service_role;
