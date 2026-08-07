-- Corrige batidas manuais do espelho para origem Admin/RH.
-- Sem isso, trigger legado preenche origin='mobile' e a UI bloqueia edição como se fosse App.

ALTER TABLE public.time_records
  ADD COLUMN IF NOT EXISTS is_manual boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_reason text,
  ADD COLUMN IF NOT EXISTS origin text,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_out_of_order boolean DEFAULT false;

UPDATE public.time_records
SET
  is_manual = true,
  origin = 'admin',
  source_type = 'app',
  manual_reason = COALESCE(NULLIF(manual_reason, ''), NULLIF(metadata ->> 'manual_reason', '')),
  source = COALESCE(NULLIF(source, ''), 'manual'),
  method = COALESCE(NULLIF(method, ''), 'manual')
WHERE
  COALESCE(is_manual, false) = true
  OR lower(COALESCE(source, '')) IN ('manual', 'admin')
  OR lower(COALESCE(method, '')) IN ('manual', 'admin')
  OR NULLIF(metadata ->> 'manual_reason', '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.insert_time_record_for_user(
  p_user_id uuid,
  p_company_id uuid,
  p_timestamp timestamptz,
  p_type text,
  p_source text DEFAULT 'manual',
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_allow_out_of_order boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_last_event_at timestamptz;
  v_effective_last_event_at timestamptz;
  v_is_retroactive boolean := false;
  v_is_out_of_order boolean := false;
  v_actor_role text;
  v_source_norm text := lower(btrim(COALESCE(p_source, 'manual')));
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_manual_reason text := NULLIF(v_metadata ->> 'manual_reason', '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT s.last_event_at
    INTO v_last_event_at
  FROM public.current_operational_state s
  WHERE s.company_id::text = p_company_id::text
    AND s.employee_id::text = p_user_id::text
  LIMIT 1;

  v_is_retroactive := v_last_event_at IS NOT NULL AND p_timestamp < v_last_event_at;
  IF v_is_retroactive THEN
    IF COALESCE(lower(btrim(p_source)), '') IN ('manual', 'admin') OR p_allow_out_of_order THEN
      v_is_out_of_order := true;
    ELSE
      RAISE EXCEPTION '[SQL MONOTONIC BLOCK] last_event_at regression company=% employee=%',
        p_company_id, p_user_id;
    END IF;
  END IF;

  IF v_is_retroactive THEN
    SELECT lower(COALESCE(u.role::text, ''))
      INTO v_actor_role
    FROM public.users u
    WHERE u.id::text = auth.uid()::text
      AND u.company_id::text = p_company_id::text
    LIMIT 1;

    IF COALESCE(v_actor_role, '') NOT IN ('admin', 'hr', 'manager') THEN
      RAISE EXCEPTION 'Sem permissão para inserir batida retroativa' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.time_records (
    id,
    user_id,
    company_id,
    timestamp,
    type,
    method,
    source,
    origin,
    source_type,
    is_manual,
    manual_reason,
    is_out_of_order,
    metadata,
    created_at,
    updated_at
  )
  VALUES (
    gen_random_uuid(),
    p_user_id,
    p_company_id,
    p_timestamp,
    p_type,
    'manual',
    CASE WHEN v_source_norm IN ('manual', 'admin') THEN v_source_norm ELSE 'manual' END,
    'admin',
    'app',
    true,
    v_manual_reason,
    v_is_out_of_order,
    jsonb_set(v_metadata, '{retroactive}', to_jsonb(v_is_retroactive), true),
    now(),
    now()
  )
  RETURNING id INTO v_id;

  SELECT MAX(tr.timestamp)
    INTO v_effective_last_event_at
  FROM public.time_records tr
  WHERE tr.user_id = p_user_id
    AND tr.company_id = p_company_id;

  UPDATE public.current_operational_state s
  SET last_event_at = COALESCE(v_effective_last_event_at, s.last_event_at)
  WHERE s.company_id::text = p_company_id::text
    AND s.employee_id::text = p_user_id::text;

  INSERT INTO public.audit_logs (
    id,
    company_id,
    user_id,
    severity,
    action,
    entity,
    entity_id,
    metadata,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    p_company_id,
    auth.uid(),
    CASE
      WHEN v_source_norm = 'manual' AND p_allow_out_of_order THEN 'warning'
      WHEN v_source_norm = 'manual' THEN 'info'
      WHEN v_source_norm = 'admin' THEN 'warning'
      ELSE 'error'
    END,
    CASE WHEN v_is_retroactive
      THEN 'MANUAL_TIME_RECORD_RETROACTIVE'
      ELSE 'MANUAL_TIME_RECORD_INSERT'
    END,
    'time_record',
    v_id,
    jsonb_build_object(
      'retroactive', v_is_retroactive,
      'is_out_of_order', v_is_out_of_order,
      'original_last_event_at', v_last_event_at,
      'inserted_timestamp', p_timestamp
    ),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'id', v_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_time_record_for_user_v2(
  p_user_id uuid,
  p_company_id uuid,
  p_timestamp timestamptz,
  p_type text,
  p_source text DEFAULT 'manual',
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_allow_out_of_order boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.insert_time_record_for_user(
    p_user_id::uuid,
    p_company_id::uuid,
    p_timestamp::timestamptz,
    p_type::text,
    p_source::text,
    COALESCE(p_metadata, '{}'::jsonb),
    p_allow_out_of_order
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_time_record_for_user(uuid, uuid, timestamptz, text, text, jsonb, boolean)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_time_record_for_user_v2(uuid, uuid, timestamptz, text, text, jsonb, boolean)
  TO anon, authenticated, service_role;
