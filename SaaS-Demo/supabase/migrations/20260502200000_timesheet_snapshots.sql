-- Snapshot consolidado pós-fechar folha (totais do motor); complementa timesheet_closures (gatilhos de travamento).

CREATE TABLE IF NOT EXISTS public.timesheet_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year >= 2000 AND year <= 3100),
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  bank_hours_balance NUMERIC NOT NULL DEFAULT 0,
  timesheet_closure_id UUID REFERENCES public.timesheet_closures (id) ON DELETE SET NULL,
  closed_by TEXT,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, employee_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_snapshots_company_period
  ON public.timesheet_snapshots (company_id, year, month);

CREATE INDEX IF NOT EXISTS idx_timesheet_snapshots_employee_period
  ON public.timesheet_snapshots (employee_id, year, month);

ALTER TABLE public.timesheet_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timesheet_snapshots_company_select" ON public.timesheet_snapshots;
CREATE POLICY "timesheet_snapshots_company_select"
  ON public.timesheet_snapshots FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "timesheet_snapshots_company_insert" ON public.timesheet_snapshots;
CREATE POLICY "timesheet_snapshots_company_insert"
  ON public.timesheet_snapshots FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr', 'supervisor')
  );

DROP POLICY IF EXISTS "timesheet_snapshots_company_update" ON public.timesheet_snapshots;
CREATE POLICY "timesheet_snapshots_company_update"
  ON public.timesheet_snapshots FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr', 'supervisor')
  );

COMMENT ON TABLE public.timesheet_snapshots IS 'Totai consolidados do motor (closeTimesheet) no fechamento oficial; período travado via timesheet_closures';
