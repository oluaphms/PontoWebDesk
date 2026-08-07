-- Trilha imutável de auditoria operacional (compliance / rastreabilidade).
CREATE TABLE IF NOT EXISTS public.operational_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id text NOT NULL,
  actor_id uuid REFERENCES public.users (id) ON DELETE SET NULL,

  entity_type text NOT NULL,
  entity_id uuid,

  action text NOT NULL,

  before jsonb,
  after jsonb,

  metadata jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.operational_audit_log IS
  'Eventos de task/alert/risk; append-only via service role nas APIs.';

CREATE INDEX IF NOT EXISTS idx_audit_company ON public.operational_audit_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.operational_audit_log (entity_type, entity_id);

ALTER TABLE public.operational_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operational_audit_log_select" ON public.operational_audit_log;
CREATE POLICY "operational_audit_log_select"
  ON public.operational_audit_log FOR SELECT TO authenticated
  USING (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );

-- Escrita apenas pelo backend (service_role). Utilizadores: leitura do próprio tenant.
GRANT SELECT ON public.operational_audit_log TO authenticated;
GRANT ALL ON public.operational_audit_log TO service_role;
