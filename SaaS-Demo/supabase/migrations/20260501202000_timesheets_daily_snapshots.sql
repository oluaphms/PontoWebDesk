-- Histórico imutável de pré-folha: cada recálculo grava uma nova linha.
-- timesheets_daily continua sendo o espelho "atual" (upsert); esta tabela preserva todas as revisões.

CREATE TABLE IF NOT EXISTS public.timesheets_daily_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  date DATE NOT NULL,
  recalc_run_id UUID NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tsd_snapshots_emp_company_date_created
  ON public.timesheets_daily_snapshots(employee_id, company_id, date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tsd_snapshots_run
  ON public.timesheets_daily_snapshots(recalc_run_id);

COMMENT ON TABLE public.timesheets_daily_snapshots IS
  'Snapshots append-only de timesheets_daily a cada rodada do motor; sem UPDATE/DELETE pela aplicação.';

ALTER TABLE public.timesheets_daily_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timesheets_daily_snapshots_select" ON public.timesheets_daily_snapshots;
CREATE POLICY "timesheets_daily_snapshots_select" ON public.timesheets_daily_snapshots
  FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR (
      company_id = public.get_my_company_id()
      AND public.get_my_company_id() IS NOT NULL
      AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
    )
  );

DROP POLICY IF EXISTS "timesheets_daily_snapshots_insert" ON public.timesheets_daily_snapshots;
CREATE POLICY "timesheets_daily_snapshots_insert" ON public.timesheets_daily_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

GRANT SELECT, INSERT ON public.timesheets_daily_snapshots TO authenticated;
