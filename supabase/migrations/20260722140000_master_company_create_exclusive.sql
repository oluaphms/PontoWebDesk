-- Espelho Supabase: criação de companies exclusiva do Painel Master.
-- Idempotente.

BEGIN;

DROP POLICY IF EXISTS companies_insert_authenticated ON public.companies;
DROP POLICY IF EXISTS companies_insert_master_only ON public.companies;

CREATE POLICY companies_insert_master_only ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (false);

COMMENT ON POLICY companies_insert_master_only ON public.companies IS
  'FASE 6.6+: INSERT em companies bloqueado para authenticated. Somente control plane Master / service role.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_tenant_onboarding'
  ) THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.create_tenant_onboarding(
        p_nome text,
        p_slug text,
        p_plan text DEFAULT 'free'
      )
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $body$
      BEGIN
        RAISE EXCEPTION 'COMPANY_CREATE_MASTER_ONLY: criação de empresas é exclusiva do Painel Master'
          USING ERRCODE = '42501';
      END;
      $body$;
    $fn$;

    REVOKE ALL ON FUNCTION public.create_tenant_onboarding(text, text, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.create_tenant_onboarding(text, text, text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.create_tenant_onboarding(text, text, text) FROM anon;
  END IF;
END $$;

COMMIT;
