-- RPC insert_time_record_for_user: assinatura única (6 params), sem overloads / PGRST203.
-- Schema: time_records.user_id text, company_id uuid, id text, method NOT NULL.

-- ---------------------------------------------------------------------------
-- 1) Remover TODAS as overloads existentes
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

-- Garantir drops explícitos de assinaturas conhecidas (legado)
DROP FUNCTION IF EXISTS public.insert_time_record_for_user(
  text, text, text, text, jsonb, text, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb, text
);
DROP FUNCTION IF EXISTS public.insert_time_record_for_user(
  uuid, uuid, text, text, jsonb, text, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb, text
);
DROP FUNCTION IF EXISTS public.insert_time_record_for_user(uuid, uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.insert_time_record_for_user(
  uuid, uuid, timestamptz, text, numeric, jsonb
);

-- ---------------------------------------------------------------------------
-- 2) Função canônica única
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_time_record_for_user(
  p_user_id uuid,
  p_company_id uuid,
  p_timestamp timestamptz,
  p_type text,
  p_fraud_score numeric DEFAULT NULL,
  p_fraud_flags jsonb DEFAULT NULL
)
RETURNS json
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

  IF v_admin_company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'Não autorizado: empresa diferente' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id::text = auth.uid()::text
      AND COALESCE(lower(u.role::text), '') IN ('admin', 'hr')
  ) THEN
    RAISE EXCEPTION 'Não autorizado: apenas admin/HR podem criar registros para outros usuários'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.company_id INTO v_employee_company_id
  FROM public.users u
  WHERE u.id::text = p_user_id::text
  LIMIT 1;

  IF v_employee_company_id IS NULL OR v_employee_company_id IS DISTINCT FROM p_company_id THEN
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

  RETURN json_build_object(
    'success', true,
    'id', v_id::text,
    'record_id', v_id::text,
    'timestamp', v_ts
  );
END;
$$;

COMMENT ON FUNCTION public.insert_time_record_for_user(
  uuid, uuid, timestamptz, text, numeric, jsonb
) IS 'Batida manual (admin/HR). Assinatura única PostgREST; user_id text / company_id uuid.';

GRANT EXECUTE ON FUNCTION public.insert_time_record_for_user(
  uuid, uuid, timestamptz, text, numeric, jsonb
) TO authenticated, service_role;

GRANT SELECT, INSERT ON public.time_records TO authenticated;
GRANT SELECT, INSERT ON public.time_records TO service_role;

NOTIFY pgrst, 'reload schema';
