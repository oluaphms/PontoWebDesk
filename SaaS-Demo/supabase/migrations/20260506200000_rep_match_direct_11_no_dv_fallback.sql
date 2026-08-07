-- REP produção: fallback direto 11 dígitos (sem validação de DV) quando há exatamente 1 colaborador
-- com users.cpf ou users.pis_pasep igual ao documento (rep_afd_canonical_11_digits).
-- Schema atual: PIS cadastral em pis_pasep (não há users.pis).

CREATE OR REPLACE FUNCTION public.rep_match_user_direct_11_digits_unique(
  p_company_id text,
  p_document text
)
RETURNS TABLE(user_id uuid, candidates_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cid text;
  d text;
  v_n bigint;
  v_uid uuid;
BEGIN
  v_cid := btrim(COALESCE(p_company_id, ''));
  IF v_cid = '' THEN
    RETURN;
  END IF;

  d := public.rep_normalize_document_digits(COALESCE(p_document, ''));
  IF length(d) <> 11 THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT u.id) INTO v_n
  FROM public.users u
  WHERE btrim(u.company_id::text) = v_cid
    AND (
      public.rep_afd_canonical_11_digits(u.cpf) = d
      OR public.rep_afd_canonical_11_digits(u.pis_pasep) = d
    );

  IF v_n <> 1 THEN
    RETURN;
  END IF;

  SELECT u.id INTO v_uid
  FROM public.users u
  WHERE btrim(u.company_id::text) = v_cid
    AND (
      public.rep_afd_canonical_11_digits(u.cpf) = d
      OR public.rep_afd_canonical_11_digits(u.pis_pasep) = d
    )
  ORDER BY u.id
  LIMIT 1;

  RETURN QUERY SELECT v_uid, v_n;
END;
$$;

COMMENT ON FUNCTION public.rep_match_user_direct_11_digits_unique(text, text) IS
  'REP: match único por 11 dígitos em cpf/pis_pasep sem DV; após tiered/weak.';

GRANT EXECUTE ON FUNCTION public.rep_match_user_direct_11_digits_unique(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_match_user_id_for_rep_punch_row(
  p_company_id text,
  p_pis text,
  p_cpf text,
  p_matricula text,
  p_raw_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user_uuid uuid;
  v_match_strategy text;
  v_eff text;
  v_pis_norm text;
  v_cpf_norm text;
  v_matricula_norm text;
  v_raw_line text;
  v_id_blob text;
  v_id_blob_d text;
  v_nome text;
  v_pis_pasep text;
  v_ni text;
  v_nf text;
  v_cid text;
  v_debug jsonb;
  v_t1 jsonb;
  v_t2 jsonb;
  v_t3 jsonb;
  v_t4 jsonb;
  v_pis_any text;
  v_weak uuid;
  v_weak_n bigint;
  v_nsr bigint;
  v_candidates_count bigint := 0;
  v_raw_patch jsonb := NULL;
  v_d11 text;
BEGIN
  v_cid := btrim(COALESCE(p_company_id, ''));
  IF v_cid = '' THEN
    RETURN NULL;
  END IF;

  v_nsr := NULL;
  IF p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN
    BEGIN
      v_nsr := NULLIF(trim(p_raw_data->>'nsr'), '')::bigint;
    EXCEPTION WHEN others THEN
      v_nsr := NULL;
    END;
    IF v_nsr IS NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN
      BEGIN
        v_nsr := NULLIF(trim(p_raw_data->'raw'->>'nsr'), '')::bigint;
      EXCEPTION WHEN others THEN
        v_nsr := NULL;
      END;
    END IF;
  END IF;

  v_raw_line := NULL;
  v_id_blob := NULL;
  v_id_blob_d := NULL;
  IF p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN
    v_raw_line := public.rep_compact_afd_line_from_punch_raw(p_raw_data);
  END IF;
  IF v_raw_line IS NOT NULL THEN
    v_id_blob := public.rep_afd_identifier_blob_from_compact_line(
      regexp_replace(v_raw_line, '\s', '', 'g')
    );
  END IF;
  IF v_id_blob IS NOT NULL THEN
    v_id_blob_d := regexp_replace(v_id_blob, '\D', '', 'g');
  END IF;

  v_eff := public.rep_effective_valid_pis_11_from_punch_raw(p_raw_data, p_pis, p_cpf);
  IF v_eff IS NOT NULL THEN
    v_pis_norm := v_eff;
    v_cpf_norm := NULL;
  ELSE
    v_pis_norm := public.rep_afd_canonical_11_digits(p_pis);
    v_cpf_norm := public.rep_afd_canonical_11_digits(p_cpf);
  END IF;

  v_matricula_norm := NULLIF(trim(p_matricula), '');
  IF v_matricula_norm IS NULL
    AND p_raw_data IS NOT NULL
    AND jsonb_typeof(p_raw_data) = 'object' THEN
    v_matricula_norm := NULLIF(trim(p_raw_data->>'matricula_derived'), '');
    IF v_matricula_norm IS NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN
      v_matricula_norm := NULLIF(trim(p_raw_data->'raw'->>'matricula_derived'), '');
    END IF;
  END IF;
  IF v_matricula_norm IS NULL THEN
    v_matricula_norm := public.rep_derive_matricula_from_afd_11(
      COALESCE(v_pis_norm, v_cpf_norm, p_pis, p_cpf, '')
    );
  END IF;

  SELECT t.user_id, t.match_strategy
  INTO v_user_uuid, v_match_strategy
  FROM public.rep_match_user_rep_tiered(v_cid, v_pis_norm, v_cpf_norm, v_matricula_norm) AS t
  LIMIT 1;
  IF v_user_uuid IS NOT NULL THEN
    v_candidates_count := 1;
  END IF;

  IF v_user_uuid IS NULL THEN
    v_user_uuid := public.rep_resolve_user_id_rep_blob_unique(v_cid, v_id_blob_d);
    IF v_user_uuid IS NOT NULL THEN
      v_match_strategy := 'blob';
      v_candidates_count := 1;
    END IF;
  END IF;

  IF v_user_uuid IS NULL THEN
    v_pis_any := COALESCE(
      NULLIF(trim(p_pis), ''),
      NULLIF(trim(p_cpf), ''),
      CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN NULLIF(trim(p_raw_data->>'pis'), '') END,
      CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN NULLIF(trim(p_raw_data->>'cpfOuPis'), '') END,
      CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN NULLIF(trim(p_raw_data->'raw'->>'pis'), '') END,
      CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN NULLIF(trim(p_raw_data->'raw'->>'cpfOuPis'), '') END
    );
    SELECT w.user_id, w.candidates_count
    INTO v_weak, v_weak_n
    FROM public.rep_match_user_weak_pis_sliding(v_cid, v_pis_any) AS w
    LIMIT 1;
    IF v_weak IS NOT NULL THEN
      v_user_uuid := v_weak;
      v_match_strategy := 'weak_pis_match';
      v_candidates_count := COALESCE(v_weak_n, 1);
      v_raw_patch := jsonb_build_object('match_strategy', 'weak_pis_match', 'confidence', 'medium');
    END IF;
  END IF;

  IF v_user_uuid IS NULL THEN
    FOR v_d11 IN
      SELECT DISTINCT public.rep_normalize_document_digits(NULLIF(trim(x), ''))
      FROM unnest(ARRAY[
        COALESCE(v_pis_norm, ''),
        COALESCE(v_cpf_norm, ''),
        COALESCE(v_pis_any, ''),
        COALESCE(p_pis, ''),
        COALESCE(p_cpf, ''),
        COALESCE(v_id_blob_d, '')
      ]) AS t(x)
      WHERE COALESCE(NULLIF(trim(x), ''), '') <> ''
    LOOP
      CONTINUE WHEN v_d11 IS NULL OR length(v_d11) <> 11;
      SELECT du.user_id, du.candidates_count
      INTO v_user_uuid, v_candidates_count
      FROM public.rep_match_user_direct_11_digits_unique(v_cid, v_d11) AS du
      LIMIT 1;
      IF v_user_uuid IS NOT NULL THEN
        v_match_strategy := 'direct_11_no_dv';
        v_candidates_count := COALESCE(v_candidates_count, 1);
        v_raw_patch := COALESCE(v_raw_patch, '{}'::jsonb)
          || jsonb_build_object('match_strategy', v_match_strategy, 'confidence', 'low');
        RAISE LOG '[REP MATCH FALLBACK DIRECT] %',
          jsonb_build_object('documento', v_d11, 'user_id', v_user_uuid);
        EXIT;
      END IF;
    END LOOP;
  END IF;


  -- Debug: candidatos por camada (limitado)
  SELECT COALESCE(jsonb_agg(z.id), '[]'::jsonb) INTO v_t1
  FROM (
    SELECT u.id
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND v_pis_norm IS NOT NULL
      AND public.rep_validate_pis_pasep_11_digits(v_pis_norm)
      AND public.rep_afd_canonical_11_digits(u.pis_pasep) = v_pis_norm
    LIMIT 15
  ) z;

  SELECT COALESCE(jsonb_agg(z.id), '[]'::jsonb) INTO v_t2
  FROM (
    SELECT u.id
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND v_cpf_norm IS NOT NULL
      AND public.rep_validate_cpf_11_digits(v_cpf_norm)
      AND public.rep_afd_canonical_11_digits(u.cpf) = v_cpf_norm
    LIMIT 15
  ) z;

  SELECT COALESCE(jsonb_agg(z.id), '[]'::jsonb) INTO v_t3
  FROM (
    SELECT u.id
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND v_matricula_norm IS NOT NULL
      AND public.rep_matricula_matches_user_fields(v_matricula_norm, u.numero_folha, u.numero_identificador)
    LIMIT 15
  ) z;

  SELECT COALESCE(jsonb_agg(z.id), '[]'::jsonb) INTO v_t4
  FROM (
    SELECT u.id
    FROM public.users u
    CROSS JOIN LATERAL (
      SELECT public.rep_afd_canonical_11_digits(u.pis_pasep) AS pis11
    ) x
    WHERE btrim(u.company_id::text) = v_cid
      AND x.pis11 IS NOT NULL
      AND public.rep_validate_pis_pasep_11_digits(x.pis11)
      AND v_pis_any IS NOT NULL
      AND length(public.rep_normalize_document_digits(v_pis_any)) >= 8
      AND EXISTS (
        SELECT 1
        FROM generate_series(1, length(public.rep_normalize_document_digits(v_pis_any)) - 7) g(i)
        WHERE substring(public.rep_normalize_document_digits(v_pis_any) from g.i for 8) = right(x.pis11, 8)
      )
    LIMIT 15
  ) z;

  v_debug := jsonb_build_object(
    'pis_recebido', p_pis,
    'pis_normalizado', v_pis_norm,
    'cpf', p_cpf,
    'cpf_normalizado', v_cpf_norm,
    'matricula', v_matricula_norm,
    'pis_any', v_pis_any,
    'candidatos_exact_pis', COALESCE(v_t1, '[]'::jsonb),
    'candidatos_exact_cpf', COALESCE(v_t2, '[]'::jsonb),
    'candidatos_identificador', COALESCE(v_t3, '[]'::jsonb),
    'candidatos_weak_pis', COALESCE(v_t4, '[]'::jsonb),
    'raw_data_patch_if_weak', v_raw_patch
  );

  RAISE LOG '[REP MATCH RESULT] %', jsonb_build_object(
    'nsr', v_nsr,
    'strategy', v_match_strategy,
    'candidates_count', COALESCE(v_candidates_count, 0),
    'resolved_user_id', v_user_uuid
  );

  IF v_user_uuid IS NULL THEN
    RETURN jsonb_build_object(
      'user_id', NULL,
      'match_strategy', NULL,
      'debug', v_debug
    );
  END IF;

  SELECT u.nome, u.pis_pasep, u.numero_identificador, u.numero_folha
  INTO v_nome, v_pis_pasep, v_ni, v_nf
  FROM public.users u
  WHERE u.id = v_user_uuid
  LIMIT 1;

  RETURN jsonb_build_object(
    'user_id', v_user_uuid,
    'nome', COALESCE(v_nome, ''),
    'pis_pasep', v_pis_pasep,
    'numero_identificador', v_ni,
    'numero_folha', v_nf,
    'match_strategy', v_match_strategy,
    'candidates_count', COALESCE(v_candidates_count, 0),
    'raw_data_patch', v_raw_patch,
    'debug', v_debug
  );
END;
$$;

COMMENT ON FUNCTION public.rep_match_user_id_for_rep_punch_row(text, text, text, text, jsonb) IS
  'REP match + debug; tiered + blob + weak_pis + direct_11_no_dv (único); [REP MATCH RESULT] / [REP MATCH FALLBACK DIRECT].';

GRANT EXECUTE ON FUNCTION public.rep_match_user_id_for_rep_punch_row(text, text, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rep_ingest_punch(
  p_company_id text,
  p_rep_device_id uuid DEFAULT NULL,
  p_pis text DEFAULT NULL,
  p_cpf text DEFAULT NULL,
  p_matricula text DEFAULT NULL,
  p_nome_funcionario text DEFAULT NULL,
  p_data_hora timestamptz DEFAULT NULL,
  p_tipo_marcacao text DEFAULT NULL,
  p_nsr bigint DEFAULT NULL,
  p_raw_data jsonb DEFAULT '{}',
  p_only_staging boolean DEFAULT FALSE,
  p_apply_schedule boolean DEFAULT FALSE,
  p_force_user_id uuid DEFAULT NULL,
  p_trust_client_identity boolean DEFAULT FALSE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user_id text;
  v_user_uuid uuid;
  v_match_strategy text;
  v_pis_norm text;
  v_cpf_norm text;
  v_matricula_norm text;
  v_record_id text;
  v_log_id uuid;
  v_tipo_marcacao text;
  v_tipo_tr text;
  v_js_dow int;
  v_local_ts timestamptz;
  v_sched_entry time;
  v_tol int;
  v_entrada_mins int;
  v_start_mins int;
  v_is_late boolean := FALSE;
  v_interpretation jsonb;
  v_existing_types text[];
  v_company_uuid uuid;
  v_dup_log_id uuid;
  v_dup_time_record_id uuid;
  v_eff text;
  v_raw_line text;
  v_id_blob text;
  v_id_blob_d text;
  v_cid text;
  v_raw_out jsonb;
  v_log_pis text;
  v_log_cpf text;
  v_u_pis text;
  v_pis_any text;
  v_weak uuid;
  v_weak_n bigint;
  v_candidates_count bigint := 0;
  v_d11 text;
BEGIN
  v_cid := btrim(COALESCE(p_company_id, ''));
  v_company_uuid := v_cid::uuid;

  v_eff := public.rep_effective_valid_pis_11_from_punch_raw(p_raw_data, p_pis, p_cpf);
  IF v_eff IS NOT NULL THEN
    v_pis_norm := v_eff;
    v_cpf_norm := v_eff;
  ELSE
    v_pis_norm := public.rep_afd_canonical_11_digits(p_pis);
    v_cpf_norm := public.rep_afd_canonical_11_digits(p_cpf);
  END IF;

  v_matricula_norm := NULLIF(trim(p_matricula), '');
  IF v_matricula_norm IS NULL
    AND p_raw_data IS NOT NULL
    AND jsonb_typeof(p_raw_data) = 'object' THEN
    v_matricula_norm := NULLIF(trim(p_raw_data->>'matricula_derived'), '');
    IF v_matricula_norm IS NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN
      v_matricula_norm := NULLIF(trim(p_raw_data->'raw'->>'matricula_derived'), '');
    END IF;
  END IF;
  IF v_matricula_norm IS NULL THEN
    v_matricula_norm := public.rep_derive_matricula_from_afd_11(
      COALESCE(v_pis_norm, v_cpf_norm, p_pis, p_cpf, '')
    );
  END IF;

  IF p_nsr IS NOT NULL THEN
    v_dup_log_id := NULL;
    v_dup_time_record_id := NULL;
    SELECT id, time_record_id
    INTO v_dup_log_id, v_dup_time_record_id
    FROM public.rep_punch_logs
    WHERE company_id = p_company_id
      AND nsr = p_nsr
      AND source = 'rep'
      AND dedupe_device = COALESCE(p_rep_device_id::text, '')
    LIMIT 1;
    IF v_dup_log_id IS NOT NULL AND v_dup_time_record_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'NSR já importado', 'duplicate', true);
    END IF;
  END IF;

  v_raw_line := NULL;
  v_id_blob_d := NULL;
  IF p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN
    v_raw_line := public.rep_compact_afd_line_from_punch_raw(p_raw_data);
  END IF;
  IF v_raw_line IS NOT NULL THEN
    v_id_blob := public.rep_afd_identifier_blob_from_compact_line(
      regexp_replace(v_raw_line, '\s', '', 'g')
    );
    IF v_id_blob IS NOT NULL THEN
      v_id_blob_d := regexp_replace(v_id_blob, '\D', '', 'g');
    END IF;
  END IF;

  v_match_strategy := NULL;
  v_raw_out := COALESCE(p_raw_data, '{}'::jsonb);
  v_log_pis := p_pis;
  v_log_cpf := p_cpf;

  IF p_force_user_id IS NOT NULL THEN
    v_user_uuid := (
      SELECT u.id
      FROM public.users u
      WHERE u.id = p_force_user_id
        AND btrim(u.company_id::text) = v_cid
      LIMIT 1
    );
    IF v_user_uuid IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'p_force_user_id inválido ou colaborador de outra empresa'
      );
    END IF;
    v_user_id := v_user_uuid::text;
    v_candidates_count := 1;
  ELSIF p_trust_client_identity THEN
    v_user_uuid := NULL;
    v_user_id := NULL;
    v_match_strategy := NULL;
    v_raw_out := (
      COALESCE(v_raw_out, '{}'::jsonb)
      - 'canonical_user_id'
      - 'matched_user_id'
      - 'match_strategy'
      - 'confidence'
    ) || jsonb_build_object(
      'unresolved', true,
      'unresolved_reason', 'no_match'
    );
  ELSE
    SELECT t.user_id, t.match_strategy
    INTO v_user_uuid, v_match_strategy
    FROM public.rep_match_user_rep_tiered(v_cid, v_pis_norm, v_cpf_norm, v_matricula_norm) AS t
    LIMIT 1;

    IF v_user_uuid IS NULL THEN
      v_user_uuid := public.rep_resolve_user_id_rep_blob_unique(v_cid, v_id_blob_d);
      IF v_user_uuid IS NOT NULL THEN
        v_match_strategy := 'blob';
      END IF;
    END IF;

    IF v_user_uuid IS NULL THEN
      v_pis_any := COALESCE(
        NULLIF(trim(p_pis), ''),
        NULLIF(trim(p_cpf), ''),
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN NULLIF(trim(p_raw_data->>'pis'), '') END,
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN NULLIF(trim(p_raw_data->>'cpfOuPis'), '') END,
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN NULLIF(trim(p_raw_data->'raw'->>'pis'), '') END,
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN NULLIF(trim(p_raw_data->'raw'->>'cpfOuPis'), '') END
      );
      SELECT w.user_id, w.candidates_count
      INTO v_weak, v_weak_n
      FROM public.rep_match_user_weak_pis_sliding(v_cid, v_pis_any) AS w
      LIMIT 1;
      IF v_weak IS NOT NULL THEN
        v_user_uuid := v_weak;
        v_match_strategy := 'weak_pis_match';
        v_candidates_count := COALESCE(v_weak_n, 1);
      END IF;
    END IF;

    IF v_user_uuid IS NULL THEN
      FOR v_d11 IN
        SELECT DISTINCT public.rep_normalize_document_digits(NULLIF(trim(x), ''))
        FROM unnest(ARRAY[
          COALESCE(v_pis_norm, ''),
          COALESCE(v_cpf_norm, ''),
          COALESCE(v_pis_any, ''),
          COALESCE(p_pis, ''),
          COALESCE(p_cpf, ''),
          COALESCE(v_id_blob_d, ''),
          CASE WHEN v_id_blob_d IS NOT NULL AND length(v_id_blob_d) >= 11 THEN substring(v_id_blob_d from 1 for 11) END,
          CASE WHEN v_id_blob_d IS NOT NULL AND length(v_id_blob_d) > 11 THEN substring(v_id_blob_d from length(v_id_blob_d) - 10 for 11) END
        ]) AS t(x)
        WHERE COALESCE(NULLIF(trim(x), ''), '') <> ''
      LOOP
        CONTINUE WHEN v_d11 IS NULL OR length(v_d11) <> 11;
        SELECT du.user_id, du.candidates_count
        INTO v_user_uuid, v_candidates_count
        FROM public.rep_match_user_direct_11_digits_unique(v_cid, v_d11) AS du
        LIMIT 1;
        IF v_user_uuid IS NOT NULL THEN
          v_match_strategy := 'direct_11_no_dv';
          v_candidates_count := COALESCE(v_candidates_count, 1);
          RAISE LOG '[REP MATCH FALLBACK DIRECT] %',
            jsonb_build_object('documento', v_d11, 'user_id', v_user_uuid);
          EXIT;
        END IF;
      END LOOP;
    END IF;

    v_user_id := v_user_uuid::text;
    IF v_user_uuid IS NOT NULL AND v_candidates_count = 0 THEN
      v_candidates_count := 1;
    END IF;

    IF v_match_strategy IN ('fallback', 'blob', 'weak_pis_match', 'direct_11_no_dv') AND v_user_uuid IS NOT NULL THEN
      SELECT NULLIF(trim(u.pis_pasep), '') INTO v_u_pis
      FROM public.users u
      WHERE u.id = v_user_uuid
      LIMIT 1;
      IF v_u_pis IS NOT NULL THEN
        v_log_pis := v_u_pis;
        v_log_cpf := v_u_pis;
      END IF;

      IF v_match_strategy = 'weak_pis_match' THEN
        v_raw_out := v_raw_out || jsonb_build_object(
          'match_strategy', v_match_strategy,
          'matched_user_id', v_user_uuid::text,
          'confidence', 'medium'
        );
      ELSIF v_match_strategy = 'direct_11_no_dv' THEN
        v_raw_out := v_raw_out || jsonb_build_object(
          'match_strategy', v_match_strategy,
          'matched_user_id', v_user_uuid::text,
          'confidence', 'low'
        );
      ELSE
        v_raw_out := v_raw_out || jsonb_build_object(
          'match_strategy', v_match_strategy,
          'matched_user_id', v_user_uuid::text
        );
      END IF;
    END IF;
  END IF;

  RAISE LOG '[REP MATCH RESULT] %', jsonb_build_object(
    'nsr', p_nsr,
    'strategy', v_match_strategy,
    'candidates_count', COALESCE(v_candidates_count, 0),
    'resolved_user_id', v_user_uuid
  );

  IF v_user_id IS NOT NULL THEN
    v_raw_out := (
      COALESCE(v_raw_out, '{}'::jsonb)
      - 'unresolved'
      - 'unresolved_reason'
    ) || jsonb_build_object('canonical_user_id', v_user_id);
  END IF;

  -- Última tentativa antes do espelho: match direto 11 dígitos (cpf/pis_pasep único), sem depender só da 1ª passagem
  IF v_user_id IS NULL AND NOT p_trust_client_identity THEN
    IF v_pis_any IS NULL THEN
      v_pis_any := COALESCE(
        NULLIF(trim(p_pis), ''),
        NULLIF(trim(p_cpf), ''),
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN NULLIF(trim(p_raw_data->>'pis'), '') END,
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN NULLIF(trim(p_raw_data->>'cpfOuPis'), '') END,
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN NULLIF(trim(p_raw_data->'raw'->>'pis'), '') END,
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN NULLIF(trim(p_raw_data->'raw'->>'cpfOuPis'), '') END
      );
    END IF;
    FOR v_d11 IN
      SELECT DISTINCT public.rep_normalize_document_digits(NULLIF(trim(x), ''))
      FROM unnest(ARRAY[
        COALESCE(v_pis_norm, ''),
        COALESCE(v_cpf_norm, ''),
        COALESCE(v_pis_any, ''),
        COALESCE(p_pis, ''),
        COALESCE(p_cpf, ''),
        COALESCE(v_id_blob_d, ''),
        CASE WHEN v_id_blob_d IS NOT NULL AND length(v_id_blob_d) >= 11 THEN substring(v_id_blob_d from 1 for 11) END,
        CASE WHEN v_id_blob_d IS NOT NULL AND length(v_id_blob_d) > 11 THEN substring(v_id_blob_d from length(v_id_blob_d) - 10 for 11) END
      ]) AS t(x)
      WHERE COALESCE(NULLIF(trim(x), ''), '') <> ''
    LOOP
      CONTINUE WHEN v_d11 IS NULL OR length(v_d11) <> 11;
      SELECT du.user_id INTO v_user_uuid
      FROM public.rep_match_user_direct_11_digits_unique(v_cid, v_d11) AS du
      LIMIT 1;
      IF v_user_uuid IS NOT NULL THEN
        v_match_strategy := 'direct_11_no_dv';
        v_candidates_count := 1;
        v_user_id := v_user_uuid::text;
        SELECT NULLIF(trim(u.pis_pasep), '') INTO v_u_pis
        FROM public.users u
        WHERE u.id = v_user_uuid
        LIMIT 1;
        IF v_u_pis IS NOT NULL THEN
          v_log_pis := v_u_pis;
          v_log_cpf := v_u_pis;
        END IF;
        v_raw_out := (
          COALESCE(v_raw_out, '{}'::jsonb)
          - 'unresolved'
          - 'unresolved_reason'
        ) || jsonb_build_object(
          'canonical_user_id', v_user_id,
          'match_strategy', 'direct_11_no_dv',
          'matched_user_id', v_user_id,
          'confidence', 'low',
          'ingest_force_match', true
        );
        RAISE LOG '[REP INGEST FORCE MATCH] %', jsonb_build_object('nsr', p_nsr, 'resolved_user_id', v_user_id);
        EXIT;
      END IF;
    END LOOP;
  END IF;

  v_tipo_marcacao := UPPER(LEFT(COALESCE(NULLIF(trim(p_tipo_marcacao), ''), 'E'), 1));
  IF v_tipo_marcacao NOT IN ('E', 'S', 'P', 'B') THEN
    v_tipo_marcacao := 'B';
  END IF;

  IF v_tipo_marcacao = 'B' OR p_tipo_marcacao IS NULL OR trim(p_tipo_marcacao) = '' OR lower(p_tipo_marcacao) = 'batida' THEN
    v_existing_types := (
      SELECT array_agg(tr.type ORDER BY tr.timestamp)
      FROM public.time_records tr
      WHERE tr.company_id = p_company_id
        AND tr.user_id = v_user_id
        AND DATE(tr.timestamp AT TIME ZONE 'America/Sao_Paulo') = DATE(p_data_hora AT TIME ZONE 'America/Sao_Paulo')
    );

    IF v_user_uuid IS NOT NULL THEN
      v_interpretation := public.interpret_punch_by_schedule(
        v_user_uuid,
        v_company_uuid,
        p_data_hora,
        v_existing_types
      );
      v_tipo_tr := v_interpretation->>'type';
      v_is_late := COALESCE((v_interpretation->>'is_late')::boolean, FALSE);
    ELSE
      v_tipo_tr := CASE COALESCE(array_length(v_existing_types, 1), 0) % 2
        WHEN 0 THEN 'entrada'
        ELSE 'saída'
      END;
    END IF;
  ELSE
    v_tipo_tr := CASE v_tipo_marcacao
      WHEN 'E' THEN 'entrada'
      WHEN 'S' THEN 'saída'
      WHEN 'P' THEN 'pausa'
      ELSE 'entrada'
    END;
  END IF;

  INSERT INTO public.rep_punch_logs (
    company_id, rep_device_id, pis, cpf, matricula, nome_funcionario,
    data_hora, tipo_marcacao, nsr, origem, source, raw_data, resolved_user_id
  ) VALUES (
    p_company_id,
    p_rep_device_id,
    v_log_pis,
    v_log_cpf,
    COALESCE(NULLIF(trim(p_matricula), ''), v_matricula_norm),
    p_nome_funcionario,
    COALESCE(p_data_hora, NOW()),
    COALESCE(v_tipo_marcacao, v_tipo_tr::text),
    p_nsr,
    'rep',
    'rep',
    v_raw_out,
    v_user_id
  )
  ON CONFLICT (company_id, nsr, source, dedupe_device) WHERE nsr IS NOT NULL
  DO UPDATE SET
    resolved_user_id = EXCLUDED.resolved_user_id,
    raw_data = EXCLUDED.raw_data
  RETURNING id INTO v_log_id;

  IF p_only_staging THEN
    RETURN jsonb_build_object(
      'success', true,
      'rep_log_id', v_log_id,
      'user_not_found', (v_user_id IS NULL),
      'staging_only', true,
      'user_id', v_user_id,
      'interpreted_type', v_tipo_tr,
      'pending_nsr_refreshed', false,
      'match_strategy', v_match_strategy
    );
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'rep_log_id', v_log_id,
      'user_not_found', true,
      'pending_nsr_refreshed', false,
      'match_strategy', NULL
    );
  END IF;

  IF p_apply_schedule AND v_tipo_tr = 'entrada' THEN
    v_local_ts := COALESCE(p_data_hora, NOW()) AT TIME ZONE 'America/Sao_Paulo';
    v_js_dow := DATE_PART('dow', v_local_ts)::int;
    v_sched_entry := NULL;
    v_tol := 0;
    v_sched_entry := (
      SELECT t.shift_start
      FROM public.ess_day_shift_times(v_user_uuid, p_company_id, v_js_dow) t
      LIMIT 1
    );
    v_tol := COALESCE((
      SELECT t.tol
      FROM public.ess_day_shift_times(v_user_uuid, p_company_id, v_js_dow) t
      LIMIT 1
    ), 0);

    IF v_sched_entry IS NOT NULL THEN
      v_entrada_mins :=
        DATE_PART('hour', v_local_ts)::int * 60 + DATE_PART('minute', v_local_ts)::int;
      v_start_mins :=
        DATE_PART('hour', v_sched_entry)::int * 60 + DATE_PART('minute', v_sched_entry)::int;
      v_is_late := v_entrada_mins > (v_start_mins + COALESCE(v_tol, 0));
    END IF;
  END IF;

  v_record_id := gen_random_uuid()::text;
  INSERT INTO public.time_records (
    id, user_id, company_id, type, method, timestamp, source, nsr, fraud_score, is_late
  ) VALUES (
    v_record_id, v_user_id, p_company_id,
    v_tipo_tr, 'rep', COALESCE(p_data_hora, NOW()), 'rep', p_nsr, 0, v_is_late
  );
  UPDATE public.rep_punch_logs SET
    time_record_id = v_record_id,
    resolved_user_id = COALESCE(resolved_user_id, v_user_id)
  WHERE id = v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'time_record_id', v_record_id,
    'user_id', v_user_id,
    'rep_log_id', v_log_id,
    'type', v_tipo_tr,
    'interpreted', v_tipo_marcacao = 'B' OR p_tipo_marcacao IS NULL,
    'allocated_late', p_apply_schedule AND v_tipo_tr = 'entrada',
    'forced_user', p_force_user_id IS NOT NULL,
    'pending_nsr_refreshed', false,
    'match_strategy', v_match_strategy
  );
END;
$$;

COMMENT ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid, boolean
) IS 'Ingere REP; tiered + blob + weak_pis + direct_11_no_dv + force match antes do espelho; [REP MATCH RESULT] / [REP INGEST FORCE MATCH].';

GRANT EXECUTE ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid, boolean
) TO authenticated, service_role;
