-- Agendamento de backup de dados do tenant (configuração; o arquivo é gerado no cliente).
CREATE TABLE IF NOT EXISTS public.company_backup_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL UNIQUE,
  auto_enabled BOOLEAN NOT NULL DEFAULT false,
  frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('daily', 'weekly')),
  weekday SMALLINT NOT NULL DEFAULT 1 CHECK (weekday >= 0 AND weekday <= 6),
  hour SMALLINT NOT NULL DEFAULT 2 CHECK (hour >= 0 AND hour <= 23),
  minute SMALLINT NOT NULL DEFAULT 0 CHECK (minute >= 0 AND minute <= 59),
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_backup_settings_company_id ON public.company_backup_settings(company_id);

ALTER TABLE public.company_backup_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_backup_settings_select_staff" ON public.company_backup_settings;
CREATE POLICY "company_backup_settings_select_staff" ON public.company_backup_settings
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

DROP POLICY IF EXISTS "company_backup_settings_upsert_staff" ON public.company_backup_settings;
CREATE POLICY "company_backup_settings_upsert_staff" ON public.company_backup_settings
  FOR ALL TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  )
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_backup_settings TO authenticated;

COMMENT ON TABLE public.company_backup_settings IS
  'Preferências de backup automático (disparo no app admin/RH com aba aberta; horário no fuso do navegador).';

DROP TRIGGER IF EXISTS update_company_backup_settings_updated_at ON public.company_backup_settings;
CREATE TRIGGER update_company_backup_settings_updated_at
  BEFORE UPDATE ON public.company_backup_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
