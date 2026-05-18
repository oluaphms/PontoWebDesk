-- Reexpõe RPC + time_records ao PostgREST (corrige 404 após CREATE FUNCTION no SQL Editor).
-- Após rodar: Supabase Dashboard → Settings → API → "Reload schema" (se 404 persistir).

-- ---------------------------------------------------------------------------
-- 1) Grants de schema (authenticator → authenticated precisa de USAGE)
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

GRANT SELECT, INSERT ON public.time_records TO anon, authenticated, service_role;

GRANT SELECT, INSERT ON public.audit_logs TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) RPC — RETURNS jsonb (padrão PostgREST) + EXECUTE para anon/authenticated
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.insert_time_record_for_user(
  uuid, uuid, timestamptz, text, numeric, jsonb
);

CREATE OR REPLACE FUNCTION public.insert_time_record_for_user(
  p_user_id uuid,
  p_company_id uuid,
  p_timestamp timestamptz,
  p_type text,
  p_fraud_score numeric DEFAULT NULL,
  p_fraud_flags jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_id uuid;
  v_ts timestamptz := COALESCE(p_timestamp, NOW());
  v_admin_company_id uuid;
  v_employee_company_id uuid;
BEGIN
  SELECT u.company_id INTO v_admin_company_id
  FROM public.users u
  WHERE u.id::text = auth.uid()::text
  LIMIT 1;

  IF v_admin_company_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado ou não encontrado' USING ERRCODE = '42501';
  END IF;

  IF v_admin_company_id::text IS DISTINCT FROM p_company_id::text THEN
    RAISE EXCEPTION 'Não autorizado: empresa diferente' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id::text = auth.uid()::text
      AND COALESCE(lower(u.role::text), '') IN ('admin', 'hr')
  ) THEN
    RAISE EXCEPTION 'Não autorizado: apenas admin/HR' USING ERRCODE = '42501';
  END IF;

  SELECT u.company_id INTO v_employee_company_id
  FROM public.users u
  WHERE u.id::text = p_user_id::text
  LIMIT 1;

  IF v_employee_company_id IS NULL
     OR v_employee_company_id::text IS DISTINCT FROM p_company_id::text THEN
    RAISE EXCEPTION 'Funcionário não pertence à empresa' USING ERRCODE = '42501';
  END IF;

  v_id := gen_random_uuid();

  INSERT INTO public.time_records (
    id,
    user_id,
    company_id,
    timestamp,
    type,
    source,
    method,
    created_at,
    updated_at,
    is_manual,
    fraud_score,
    fraud_flags
  ) VALUES (
    v_id::text,
    p_user_id::text,
    p_company_id,
    v_ts,
    p_type,
    'manual',
    'admin',
    v_ts,
    v_ts,
    true,
    p_fraud_score,
    COALESCE(p_fraud_flags, '[]'::jsonb)
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id::text,
    'record_id', v_id::text,
    'timestamp', v_ts
  );
END;
$$;

COMMENT ON FUNCTION public.insert_time_record_for_user(
  uuid, uuid, timestamptz, text, numeric, jsonb
) IS 'Batida manual admin/HR — exposta via PostgREST REST RPC.';

GRANT EXECUTE ON FUNCTION public.insert_time_record_for_user(
  uuid, uuid, timestamptz, text, numeric, jsonb
) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Forçar reload do cache PostgREST (hosted Supabase)
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
