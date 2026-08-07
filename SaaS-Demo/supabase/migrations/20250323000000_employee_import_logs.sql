-- ============================================================
-- SmartPonto: Logs de importação de funcionários
-- employee_import_logs, employee_import_errors
-- ============================================================

CREATE TABLE IF NOT EXISTS public.employee_import_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  imported_by UUID NOT NULL,
  total_records INTEGER NOT NULL DEFAULT 0,
  success_records INTEGER NOT NULL DEFAULT 0,
  error_records INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_import_logs_company ON public.employee_import_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_employee_import_logs_created ON public.employee_import_logs(created_at DESC);
ALTER TABLE public.employee_import_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_import_logs_company" ON public.employee_import_logs;
CREATE POLICY "employee_import_logs_company" ON public.employee_import_logs
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

-- Tabela de erros por linha
CREATE TABLE IF NOT EXISTS public.employee_import_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_log_id UUID NOT NULL REFERENCES public.employee_import_logs(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  error_message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_import_errors_log ON public.employee_import_errors(import_log_id);
ALTER TABLE public.employee_import_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_import_errors_via_log" ON public.employee_import_errors;
CREATE POLICY "employee_import_errors_via_log" ON public.employee_import_errors
  FOR ALL TO authenticated
  USING (
    import_log_id IN (
      SELECT id FROM public.employee_import_logs WHERE company_id = public.get_my_company_id()
    )
  );

COMMENT ON TABLE public.employee_import_logs IS 'Log de cada execução de importação de funcionários';
COMMENT ON TABLE public.employee_import_errors IS 'Erros por linha da planilha de importação';
