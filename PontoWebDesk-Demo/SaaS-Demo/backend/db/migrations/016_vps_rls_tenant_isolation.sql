-- Sprint 6.2 — RLS na VPS como segunda linha de defesa (opt-in via VPS_RLS_ENFORCED=true).
-- Idempotente: com VPS_RLS_ENFORCED=false (default), políticas permitem todas as linhas.

CREATE OR REPLACE FUNCTION public.vps_tenant_row_visible(p_company_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE
      WHEN coalesce(nullif(current_setting('app.rls_enforced', true), ''), 'false') <> 'true' THEN true
      WHEN coalesce(nullif(current_setting('app.current_company_id', true), ''), '') <> '' THEN
        p_company_id IS NOT DISTINCT FROM current_setting('app.current_company_id', true)
      ELSE true
    END;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'employees',
    'users',
    'departments',
    'time_records',
    'rep_devices',
    'settings',
    'company_rules',
    'overtime_rules',
    'devices',
    'requests',
    'absences',
    'rep_device_commands',
    'rep_punch_logs'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = tbl
         AND column_name = 'company_id'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS vps_%I_tenant ON public.%I', tbl, tbl);
      EXECUTE format(
        'CREATE POLICY vps_%I_tenant ON public.%I FOR ALL USING (public.vps_tenant_row_visible(company_id::text)) WITH CHECK (public.vps_tenant_row_visible(company_id::text))',
        tbl,
        tbl
      );
    END IF;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.vps_tenant_row_visible(text) IS
  'RLS VPS: filtra por app.current_company_id quando app.rls_enforced=true';

ALTER TABLE public.rep_devices ADD COLUMN IF NOT EXISTS api_key_hash text;
COMMENT ON COLUMN public.rep_devices.api_key_hash IS
  'Hash pgcrypto da api_key do dispositivo — preferir public.device_keys';
