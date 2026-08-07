-- HARD LOCK produção: ledger BH explicit (FIFO + used_minutes), política extras, auditoria AFD-style

ALTER TABLE public.company_rules
  ADD COLUMN IF NOT EXISTS extra_payroll_policy TEXT NOT NULL DEFAULT 'bank'
    CHECK (extra_payroll_policy IN ('bank', 'payroll', 'mixed')),
  ADD COLUMN IF NOT EXISTS mixed_extra_bank_cap_minutes INTEGER NOT NULL DEFAULT 120
    CHECK (mixed_extra_bank_cap_minutes >= 0);

COMMENT ON COLUMN public.company_rules.extra_payroll_policy IS
  'Destino das horas extras: bank (BH), payroll (folha) ou mixed (cap diário ao BH, resto folha).';
COMMENT ON COLUMN public.company_rules.mixed_extra_bank_cap_minutes IS
  'Em modo mixed: até quantos minutos/dia do extra vão para o b antes do restante ir à folha.';

-- Ledger corporativo (crédito com FIFO via used_minutes; débito manual opcional)
CREATE TABLE IF NOT EXISTS public.bank_hours_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  date DATE NOT NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  type TEXT NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
  source TEXT NOT NULL CHECK (source IN ('EXTRA', 'ABSENCE', 'MANUAL')),
  expires_at TIMESTAMPTZ,
  used_minutes INTEGER NOT NULL DEFAULT 0 CHECK (used_minutes >= 0 AND used_minutes <= minutes),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_hours_ledger_emp_company ON public.bank_hours_ledger(employee_id, company_id);
CREATE INDEX IF NOT EXISTS idx_bank_hours_ledger_emp_company_created
  ON public.bank_hours_ledger(employee_id, company_id, created_at ASC);

ALTER TABLE public.bank_hours_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_hours_ledger_own_select" ON public.bank_hours_ledger;
CREATE POLICY "bank_hours_ledger_own_select" ON public.bank_hours_ledger
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "bank_hours_ledger_company_manage" ON public.bank_hours_ledger;
CREATE POLICY "bank_hours_ledger_company_manage" ON public.bank_hours_ledger
  FOR ALL TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  )
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_hours_ledger TO authenticated;

COMMENT ON TABLE public.bank_hours_ledger IS
  'BH: CREDIT (extra etc.) com used_minutes consumido FIFO; DEBIT para ajustes manuais.';

-- Auditoria cálculo (hash encadeado — insert obrigatório com employee_id/action/payload)
CREATE TABLE IF NOT EXISTS public.time_engine_afd_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  payload JSONB NOT NULL,
  hash TEXT NOT NULL,
  company_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_engine_afd_audit_emp_created
  ON public.time_engine_afd_audit(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_engine_afd_audit_company_created
  ON public.time_engine_afd_audit(company_id, created_at DESC);

ALTER TABLE public.time_engine_afd_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_engine_afd_audit_select" ON public.time_engine_afd_audit;
CREATE POLICY "time_engine_afd_audit_select" ON public.time_engine_afd_audit
  FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR (
      company_id = public.get_my_company_id()
      AND public.get_my_company_id() IS NOT NULL
      AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
    )
  );

DROP POLICY IF EXISTS "time_engine_afd_audit_insert" ON public.time_engine_afd_audit;
CREATE POLICY "time_engine_afd_audit_insert" ON public.time_engine_afd_audit
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

GRANT SELECT, INSERT ON public.time_engine_afd_audit TO authenticated;
