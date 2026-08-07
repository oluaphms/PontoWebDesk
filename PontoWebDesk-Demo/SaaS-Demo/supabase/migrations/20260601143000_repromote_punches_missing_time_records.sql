-- Reprocessa punches legados que ficaram com sent_at preenchido, mas sem time_record correspondente.
-- Causa raiz: sent_at foi usado por fluxos antigos como "enviado", mas o espelho lê time_records.

CREATE OR REPLACE FUNCTION public.punches_normalize_type(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_type, '')))
    WHEN 'e' THEN 'entrada'
    WHEN 'in' THEN 'entrada'
    WHEN 'clock_in' THEN 'entrada'
    WHEN 'entrada' THEN 'entrada'
    WHEN 's' THEN 'saida'
    WHEN 'out' THEN 'saida'
    WHEN 'clock_out' THEN 'saida'
    WHEN 'saída' THEN 'saida'
    WHEN 'saida' THEN 'saida'
    WHEN 'p' THEN 'pausa'
    WHEN 'pausa' THEN 'pausa'
    WHEN 'break_start' THEN 'intervalo_saida'
    WHEN 'intervalo_saida' THEN 'intervalo_saida'
    WHEN 'break_end' THEN 'intervalo_volta'
    WHEN 'intervalo_volta' THEN 'intervalo_volta'
    ELSE 'entrada'
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
  v_existing_status text := 'already_exists';
  v_inserted_id text;
BEGIN
  SELECT *
  INTO v_p
  FROM public.punches
  WHERE id = p_punch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'not_found');
  END IF;

  v_p_json := to_jsonb(v_p);
  v_user_uuid := COALESCE(
    public.punches_try_uuid(v_p_json->>'user_id'),
    public.punches_try_uuid(v_p_json->'payload'->>'user_id'),
    public.punches_try_uuid(v_p_json->'payload'->>'userId'),
    public.punches_try_uuid(v_p_json->'raw_data'->>'user_id'),
    public.punches_try_uuid(v_p_json->'raw_data'->>'userId'),
    public.punches_try_uuid(v_p.employee_id)
  );
  v_company_uuid := COALESCE(
    public.punches_try_uuid(v_p_json->>'company_id'),
    public.punches_try_uuid(v_p_json->'payload'->>'company_id'),
    public.punches_try_uuid(v_p_json->'payload'->>'companyId'),
    public.punches_try_uuid(v_p_json->'raw_data'->>'company_id'),
    public.punches_try_uuid(v_p_json->'raw_data'->>'companyId')
  );

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
    public.punches_try_timestamptz(v_p_json->'payload'->>'timestamp'),
    public.punches_try_timestamptz(v_p_json->'raw_data'->>'timestamp'),
    v_p.created_at,
    now()
  );
  v_type := public.punches_normalize_type(v_p.type);
  v_source := lower(btrim(COALESCE(NULLIF(v_p.source, ''), 'web')));
  IF v_source IN ('mobile', 'app') THEN
    v_source := 'web';
  END IF;
  v_method := lower(btrim(COALESCE(NULLIF(v_p.method, ''), 'web')));

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
    AND public.punches_normalize_type(tr.type) = v_type
    AND tr."timestamp" = v_event_ts
    AND COALESCE(lower(tr.source), '') = v_source
  LIMIT 1;

  IF v_existing_id IS NULL THEN
    SELECT tr.id::text
    INTO v_existing_id
    FROM public.time_records tr
    WHERE tr.company_id::text = v_company_uuid::text
      AND tr.user_id::text = v_user_uuid::text
      AND abs(extract(epoch FROM (tr."timestamp" - v_event_ts))) <= 2
    ORDER BY abs(extract(epoch FROM (tr."timestamp" - v_event_ts))) ASC
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      v_existing_status := 'already_exists_nearby';
    END IF;
  END IF;

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
        'status', CASE WHEN v_existing_id IS NULL THEN 'inserted' ELSE v_existing_status END,
        'promoted_at', now()
      )
    )
  WHERE p.id = p_punch_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', CASE WHEN v_existing_id IS NULL THEN 'inserted' ELSE v_existing_status END,
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
    WITH punch_norm AS (
      SELECT
        p.id,
        COALESCE(
          public.punches_try_uuid(to_jsonb(p)->>'user_id'),
          public.punches_try_uuid(to_jsonb(p)->'payload'->>'user_id'),
          public.punches_try_uuid(to_jsonb(p)->'payload'->>'userId'),
          public.punches_try_uuid(to_jsonb(p)->'raw_data'->>'user_id'),
          public.punches_try_uuid(to_jsonb(p)->'raw_data'->>'userId'),
          public.punches_try_uuid(p.employee_id)
        ) AS user_uuid,
        COALESCE(
          public.punches_try_uuid(to_jsonb(p)->>'company_id'),
          public.punches_try_uuid(to_jsonb(p)->'payload'->>'company_id'),
          public.punches_try_uuid(to_jsonb(p)->'payload'->>'companyId'),
          public.punches_try_uuid(to_jsonb(p)->'raw_data'->>'company_id'),
          public.punches_try_uuid(to_jsonb(p)->'raw_data'->>'companyId')
        ) AS company_uuid,
        COALESCE(
          public.punches_try_timestamptz(to_jsonb(p)->>'timestamp'),
          public.punches_try_timestamptz(to_jsonb(p)->'payload'->>'timestamp'),
          public.punches_try_timestamptz(to_jsonb(p)->'raw_data'->>'timestamp'),
          p.created_at
        ) AS event_ts,
        p.created_at
      FROM public.punches p
    )
    SELECT pn.id
    FROM punch_norm pn
    WHERE pn.user_uuid IS NOT NULL
      AND pn.company_uuid IS NOT NULL
      AND pn.event_ts IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.time_records tr
        WHERE tr.user_id::text = pn.user_uuid::text
          AND tr.company_id::text = pn.company_uuid::text
          AND abs(extract(epoch FROM (tr."timestamp" - pn.event_ts))) <= 2
      )
    ORDER BY pn.created_at ASC NULLS FIRST, pn.id
    LIMIT GREATEST(COALESCE(p_limit, 5000), 1)
  LOOP
    v_selected := v_selected + 1;
    v_result := public.promote_punch_to_time_record(r.id);

    CASE COALESCE(v_result->>'status', '')
      WHEN 'inserted' THEN v_inserted := v_inserted + 1;
      WHEN 'already_exists' THEN v_already := v_already + 1;
      WHEN 'already_exists_nearby' THEN v_already := v_already + 1;
      WHEN 'invalid_identity' THEN v_invalid := v_invalid + 1;
      WHEN 'tenant_mismatch' THEN v_tenant := v_tenant + 1;
      ELSE NULL;
    END CASE;
  END LOOP;

  RETURN QUERY
  SELECT v_selected, v_inserted, v_already, v_invalid, v_tenant;
END;
$$;

COMMENT ON FUNCTION public.backfill_punches_to_time_records(integer) IS
  'Backfill idempotente de punches sem time_record correspondente, independentemente de sent_at.';

SELECT * FROM public.backfill_punches_to_time_records(5000);

NOTIFY pgrst, 'reload schema';
