-- Auditoria de exclusão/desativação de relógios REP (produção).

CREATE TABLE IF NOT EXISTS public.rep_device_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  device_id UUID,
  action TEXT NOT NULL CHECK (action IN ('DELETE', 'DEACTIVATE')),
  performed_by UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.rep_device_audit_logs IS
  'Trilha de exclusão/desativação de dispositivos REP; device_id pode ficar NULL após hard delete.';

CREATE INDEX IF NOT EXISTS idx_rep_device_audit_logs_company_created
  ON public.rep_device_audit_logs (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rep_device_audit_logs_device_id
  ON public.rep_device_audit_logs (device_id)
  WHERE device_id IS NOT NULL;

ALTER TABLE public.rep_device_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rep_device_audit_logs_company" ON public.rep_device_audit_logs;
CREATE POLICY "rep_device_audit_logs_company" ON public.rep_device_audit_logs
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL)
  WITH CHECK (company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL);

GRANT SELECT, INSERT ON public.rep_device_audit_logs TO authenticated;
GRANT ALL ON public.rep_device_audit_logs TO service_role;
