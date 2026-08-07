-- Regras adicionais do motor de ponto (produção) + trilha de auditoria append-only

ALTER TABLE public.company_rules
  ADD COLUMN IF NOT EXISTS allow_auto_compensation BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS weekday_extra_above_120 TEXT NOT NULL DEFAULT '50'
    CHECK (weekday_extra_above_120 IN ('50', '100')),
  ADD COLUMN IF NOT EXISTS bank_hours_expiry_months INTEGER NOT NULL DEFAULT 6
    CHECK (bank_hours_expiry_months >= 1 AND bank_hours_expiry_months <= 60);

COMMENT ON COLUMN public.company_rules.allow_auto_compensation IS
  'Se true, negativas abatem saldo do BH (FIFO). Se false, negativa vai direto à folha.';
COMMENT ON COLUMN public.company_rules.weekday_extra_above_120 IS
  'Política para excedente de hora extra além das primeiras 2h em dia útil (50% ou 100%).';
COMMENT ON COLUMN public.company_rules.bank_hours_expiry_months IS
  'Meses até vencimento dos créditos de BH (padrão 6).';

CREATE TABLE IF NOT EXISTS public.engine_calc_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  date DATE NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engine_calc_audit_emp_company_date
  ON public.engine_calc_audit(employee_id, company_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_engine_calc_audit_created
  ON public.engine_calc_audit(created_at DESC);

ALTER TABLE public.engine_calc_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "engine_calc_audit_own_select" ON public.engine_calc_audit;
DROP POLICY IF EXISTS "engine_calc_audit_company_select" ON public.engine_calc_audit;
DROP POLICY IF EXISTS "engine_calc_audit_select" ON public.engine_calc_audit;

CREATE POLICY "engine_calc_audit_select" ON public.engine_calc_audit
  FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR (
      company_id = public.get_my_company_id()
      AND public.get_my_company_id() IS NOT NULL
      AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
    )
  );

DROP POLICY IF EXISTS "engine_calc_audit_company_manage" ON public.engine_calc_audit;
CREATE POLICY "engine_calc_audit_company_insert" ON public.engine_calc_audit
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

GRANT SELECT, INSERT ON public.engine_calc_audit TO authenticated;
