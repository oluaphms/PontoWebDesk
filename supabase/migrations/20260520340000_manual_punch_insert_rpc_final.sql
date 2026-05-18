-- Batida manual: RPC única (6 params), sem overloads PGRST203, audit_logs INSERT, PostgREST.
-- Schema real: time_records.id/user_id TEXT (UUID canônico em string), company_id UUID.

-- ---------------------------------------------------------------------------
-- 1) Remover TODAS as overloads de insert_time_record_for_user
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'insert_time_record_for_user'
  LOOP
    EXECUTE format(
      'DROP FUNCTION IF EXISTS public.insert_time_record_for_user(%s)',
      r.args
    );
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.insert_time_record_for_user;
DROP FUNCTION IF EXISTS public.insert_time_record_for_user(uuid, uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.insert_time_record_for_user(
  uuid, uuid, timestamptz, text, numeric, jsonb
);
DROP FUNCTION IF EXISTS public.insert_time_record_for_user(
  uuid, uuid, text, text, jsonb, text, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb, text
);
DROP FUNCTION IF EXISTS public.insert_time_record_for_user(
  text, text, text, text, jsonb, text, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb, text
);

-- ---------------------------------------------------------------------------
-- 2) Garantir company_id UUID (user_id permanece TEXT por compatibilidade RLS/REP)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'time_records'
      AND column_name = 'company_id'
      AND data_type IN ('text', 'character varying')
  ) THEN
    ALTER TABLE public.time_records
      ALTER COLUMN company_id TYPE uuid
      USING NULLIF(btrim(company_id::text), '')::uuid;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) RPC canônica única — parâmetros UUID + timestamptz (PostgREST)
-- ---------------------------------------------------------------------------
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
  IF p_user_id IS NULL OR p_company_id IS NULL THEN
    RAISE EXCEPTION 'user_id e company_id são obrigatórios' USING ERRCODE = '22023';
  END IF;

  IF btrim(COALESCE(p_type, '')) = '' THEN
    RAISE EXCEPTION 'type é obrigatório' USING ERRCODE = '22023';
  END IF;

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
) IS 'Batida manual admin/HR — assinatura única PostgREST (6 params).';

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.insert_time_record_for_user(
  uuid, uuid, timestamptz, text, numeric, jsonb
) TO anon, authenticated, service_role;

GRANT SELECT, INSERT ON public.time_records TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) audit_logs — INSERT liberado para authenticated (evita RLS em logging)
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_insert_own" ON public.audit_logs;
DROP POLICY IF EXISTS "Audit logs insert authenticated" ON public.audit_logs;
DROP POLICY IF EXISTS "Allow insert audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_insert" ON public.audit_logs;

CREATE POLICY "audit_insert"
  ON public.audit_logs
  FOR INSERT
  TO authenticated, service_role
  WITH CHECK (auth.uid() IS NOT NULL OR current_user IN ('service_role', 'postgres'));

GRANT SELECT, INSERT ON public.audit_logs TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) PostgREST schema reload
-- ---------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
