-- Razão histórico: ledger de Banco de Horas (BH) tipo movimentação (+créditos / −débitos), FIFO no app.
CREATE TABLE IF NOT EXISTS public.bank_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  date DATE NOT NULL,
  minutes INTEGER NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('extra', 'negative', 'compensation', 'manual')),
  expires_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_entries_employee_company ON public.bank_entries(employee_id, company_id);
CREATE INDEX IF NOT EXISTS idx_bank_entries_employee_company_date ON public.bank_entries(employee_id, company_id, date);

ALTER TABLE public.bank_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_entries_own_select" ON public.bank_entries;
CREATE POLICY "bank_entries_own_select" ON public.bank_entries
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "bank_entries_company_manage" ON public.bank_entries;
CREATE POLICY "bank_entries_company_manage" ON public.bank_entries
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

COMMENT ON TABLE public.bank_entries IS
  'Movimentação de BH (+extra, −saldo coberto por FIFO, −manual etc.); FIFO e saldo tratados pelo motor.';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_entries TO authenticated;
