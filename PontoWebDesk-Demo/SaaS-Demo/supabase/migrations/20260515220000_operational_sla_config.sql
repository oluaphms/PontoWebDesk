-- Configuração de SLA / canais de notificação por empresa (operacional).
CREATE TABLE IF NOT EXISTS public.operational_sla_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id text NOT NULL UNIQUE,

  max_pending_rep_minutes int NOT NULL DEFAULT 60,
  max_open_shift_minutes int NOT NULL DEFAULT 600,
  max_inconsistencies int NOT NULL DEFAULT 3,

  notify_email boolean NOT NULL DEFAULT true,
  notify_whatsapp boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.operational_sla_config IS
  'SLA e preferências de notificação para risco operacional (alertas não resolvidos).';

ALTER TABLE public.operational_sla_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operational_sla_select" ON public.operational_sla_config;
CREATE POLICY "operational_sla_select"
  ON public.operational_sla_config FOR SELECT TO authenticated
  USING (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "operational_sla_insert" ON public.operational_sla_config;
CREATE POLICY "operational_sla_insert"
  ON public.operational_sla_config FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "operational_sla_update" ON public.operational_sla_config;
CREATE POLICY "operational_sla_update"
  ON public.operational_sla_config FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  )
  WITH CHECK (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );

GRANT SELECT, INSERT, UPDATE ON public.operational_sla_config TO authenticated;
GRANT ALL ON public.operational_sla_config TO service_role;
