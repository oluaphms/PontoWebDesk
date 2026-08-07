-- Garantir promoção de public.punches para public.time_records com idempotência.
-- Causa raiz: tabela punches tinha semântica de fila (sent_at/error_count), mas sem
-- rotina de promoção consistente para o espelho (time_records).

CREATE OR REPLACE FUNCTION public.punches_normalize_type(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE upper(btrim(COALESCE(p_type, '')))
    WHEN 'E' THEN 'entrada'
    WHEN 'ENTRADA' THEN 'entrada'
    WHEN 'S' THEN 'saída'
    WHEN 'SAIDA' THEN 'saída'
    WHEN 'SAÍDA' THEN 'saída'
    WHEN 'P' THEN 'pausa'
    WHEN 'PAUSA' THEN 'pausa'
    ELSE 'entrada'
  END;
$$;

CREATE OR REPLACE FUNCTION public.punches_try_uuid(p_value text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF btrim(COALESCE(p_value, '')) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_value)::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.punches_try_timestamptz(p_value text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF btrim(COALESCE(p_value, '')) = '' THEN
    RETURN NULL;
  END IF;
  RETURN btrim(p_value)::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_punch_to_time_record(
  p_punch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_p public.punches%ROWTYPE;
  v_p_json jsonb;
  v_user_uuid uuid;
  v_company_uuid uuid;
  v_user_company_uuid uuid;
  v_event_ts timestamptz;
  v_type text;
  v_source text;
  v_method text;
  v_existing_id text;
  v_inserted_id text;
BEGIN
  SELECT *
  INTO v_p
  FROM public.punches
  WHERE id = p_punch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'not_found'
    );
  END IF;

  v_p_json := to_jsonb(v_p);

  v_user_uuid := COALESCE(
    public.punches_try_uuid(v_p_json->>'user_id'),
    public.punches_try_uuid(v_p.employee_id)
  );

  v_company_uuid := public.punches_try_uuid(v_p.company_id);

  IF v_user_uuid IS NOT NULL THEN
    SELECT u.company_id
    INTO v_user_company_uuid
    FROM public.users u
    WHERE u.id = v_user_uuid
    LIMIT 1;
  END IF;

  v_company_uuid := COALESCE(v_company_uuid, v_user_company_uuid);
  v_event_ts := COALESCE(
    public.punches_try_timestamptz(v_p_json->>'timestamp'),
    v_p.created_at,
    now()
  );
  v_type := public.punches_normalize_type(v_p.type);
  v_source := lower(btrim(COALESCE(v_p.source, 'web')));
  v_method := lower(btrim(COALESCE(v_p.method, 'web')));

  IF v_user_uuid IS NULL OR v_company_uuid IS NULL OR v_user_company_uuid IS NULL THEN
    UPDATE public.punches p
    SET error_count = COALESCE(p.error_count, 0) + 1
    WHERE p.id = p_punch_id;

    RETURN jsonb_build_object(
      'success', false,
      'status', 'invalid_identity',
      'punch_id', p_punch_id
    );
  END IF;

  IF v_company_uuid IS DISTINCT FROM v_user_company_uuid THEN
    UPDATE public.punches p
    SET error_count = COALESCE(p.error_count, 0) + 1
    WHERE p.id = p_punch_id;

    RETURN jsonb_build_object(
      'success', false,
      'status', 'tenant_mismatch',
      'punch_id', p_punch_id
    );
  END IF;

  SELECT tr.id::text
  INTO v_existing_id
  FROM public.time_records tr
  WHERE tr.company_id::text = v_company_uuid::text
    AND tr.user_id::text = v_user_uuid::text
    AND tr.type = v_type
    AND tr."timestamp" = v_event_ts
    AND COALESCE(lower(tr.source), '') = v_source
  LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.time_records (
      id,
      user_id,
      company_id,
      type,
      method,
      "timestamp",
      source,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_uuid,
      v_company_uuid,
      v_type,
      v_method,
      v_event_ts,
      v_source,
      COALESCE(v_p.created_at, now()),
      now()
    )
    RETURNING id::text INTO v_inserted_id;
  END IF;

  UPDATE public.punches p
  SET
    sent_at = now(),
    error_count = 0,
    raw_data = COALESCE(p.raw_data, '{}'::jsonb) || jsonb_build_object(
      'promotion',
      jsonb_build_object(
        'time_record_id', COALESCE(v_existing_id, v_inserted_id),
        'status', CASE WHEN v_existing_id IS NULL THEN 'inserted' ELSE 'already_exists' END,
        'promoted_at', now()
      )
    )
  WHERE p.id = p_punch_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', CASE WHEN v_existing_id IS NULL THEN 'inserted' ELSE 'already_exists' END,
    'time_record_id', COALESCE(v_existing_id, v_inserted_id),
    'punch_id', p_punch_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_punches_to_time_records(
  p_limit integer DEFAULT 5000
)
RETURNS TABLE (
  total_selected integer,
  inserted_count integer,
  already_exists_count integer,
  invalid_identity_count integer,
  tenant_mismatch_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r record;
  v_result jsonb;
  v_selected integer := 0;
  v_inserted integer := 0;
  v_already integer := 0;
  v_invalid integer := 0;
  v_tenant integer := 0;
BEGIN
  FOR r IN
    SELECT p.id
    FROM public.punches p
    WHERE p.sent_at IS NULL
    ORDER BY p.created_at ASC NULLS FIRST, p.id
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  LOOP
    v_selected := v_selected + 1;
    v_result := public.promote_punch_to_time_record(r.id);

    CASE COALESCE(v_result->>'status', '')
      WHEN 'inserted' THEN v_inserted := v_inserted + 1;
      WHEN 'already_exists' THEN v_already := v_already + 1;
      WHEN 'invalid_identity' THEN v_invalid := v_invalid + 1;
      WHEN 'tenant_mismatch' THEN v_tenant := v_tenant + 1;
      ELSE NULL;
    END CASE;
  END LOOP;

  RETURN QUERY
  SELECT
    v_selected,
    v_inserted,
    v_already,
    v_invalid,
    v_tenant;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_promote_punch_to_time_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF NEW.sent_at IS NULL THEN
    PERFORM public.promote_punch_to_time_record(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_promote_punch_to_time_record ON public.punches;
CREATE TRIGGER tr_promote_punch_to_time_record
  AFTER INSERT ON public.punches
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_promote_punch_to_time_record();

-- Índice de apoio para varredura de backlog pendente.
CREATE INDEX IF NOT EXISTS idx_punches_pending_sent_at
  ON public.punches (sent_at, created_at);

GRANT EXECUTE ON FUNCTION public.promote_punch_to_time_record(uuid)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.backfill_punches_to_time_records(integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.promote_punch_to_time_record(uuid) IS
  'Promove 1 linha de punches para time_records com deduplicação por empresa/usuário/tipo/timestamp/source.';

COMMENT ON FUNCTION public.backfill_punches_to_time_records(integer) IS
  'Backfill idempotente de punches pendentes (sent_at IS NULL) para time_records.';

-- Backfill inicial (idempotente). Reexecuções são seguras.
SELECT * FROM public.backfill_punches_to_time_records(5000);

NOTIFY pgrst, 'reload schema';
