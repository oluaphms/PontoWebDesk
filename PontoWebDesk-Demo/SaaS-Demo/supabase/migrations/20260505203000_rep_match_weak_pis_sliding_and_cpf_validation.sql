-- REP: match robusto quando PIS vem inconsistente (Control iD)
-- - PIS forte: só se DV válido (11 dígitos)
-- - CPF: só se DV válido (11 dígitos)
-- - Matrícula / nº identificador
-- - Fallback inteligente: "similaridade de PIS" (últimos 8 + janela deslizante), só se candidato único
-- - Se fallback usado: raw_data.match_strategy='weak_pis_match' + confidence='medium'
-- - Log detalhado: [REP MATCH RESULT] { nsr, strategy, candidates_count, resolved_user_id }

CREATE OR REPLACE FUNCTION public.rep_validate_cpf_11_digits(p_digits text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  i int;
  s int;
  r int;
  dv1 int;
  dv2 int;
BEGIN
  IF p_digits !~ '^\d{11}$' THEN
    RETURN FALSE;
  END IF;
  IF p_digits ~ '^(\d)\1{10}$' THEN
    RETURN FALSE;
  END IF;

  s := 0;
  FOR i IN 1..9 LOOP
    s := s + (substring(p_digits from i for 1))::int * (11 - i);
  END LOOP;
  r := s % 11;
  dv1 := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
  IF dv1 <> (substring(p_digits from 10 for 1))::int THEN
    RETURN FALSE;
  END IF;

  s := 0;
  FOR i IN 1..10 LOOP
    s := s + (substring(p_digits from i for 1))::int * (12 - i);
  END LOOP;
  r := s % 11;
  dv2 := CASE WHEN r < 2 THEN 0 ELSE 11 - r END;
  RETURN dv2 = (substring(p_digits from 11 for 1))::int;
END;
$$;

COMMENT ON FUNCTION public.rep_validate_cpf_11_digits(text) IS
  'DV CPF (11 dígitos), rejeita sequências repetidas; usado no match REP.';

-- Fallback inteligente: janelas de 8 dígitos do documento recebido comparadas ao sufixo(8)
-- do PIS válido do colaborador. Só devolve quando há candidato único na empresa.
CREATE OR REPLACE FUNCTION public.rep_match_user_weak_pis_sliding(
  p_company_id text,
  p_pis_any text
)
RETURNS TABLE(user_id uuid, candidates_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cid text;
  d text;
  n int;
  v_n bigint;
  v_uid uuid;
BEGIN
  v_cid := btrim(COALESCE(p_company_id, ''));
  IF v_cid = '' THEN
    RETURN;
  END IF;

  d := public.rep_normalize_document_digits(COALESCE(p_pis_any, ''));
  n := length(d);
  IF n < 8 THEN
    RETURN;
  END IF;

  SELECT COUNT(DISTINCT u.id) INTO v_n
  FROM public.users u
  CROSS JOIN LATERAL (
    SELECT public.rep_afd_canonical_11_digits(u.pis_pasep) AS pis11
  ) x
  WHERE btrim(u.company_id::text) = v_cid
    AND x.pis11 IS NOT NULL
    AND public.rep_validate_pis_pasep_11_digits(x.pis11)
    AND EXISTS (
      SELECT 1
      FROM generate_series(1, n - 7) g(i)
      WHERE substring(d from g.i for 8) = right(x.pis11, 8)
    );

  IF v_n <> 1 THEN
    RETURN;
  END IF;

  SELECT u.id INTO v_uid
  FROM public.users u
  CROSS JOIN LATERAL (
    SELECT public.rep_afd_canonical_11_digits(u.pis_pasep) AS pis11
  ) x
  WHERE btrim(u.company_id::text) = v_cid
    AND x.pis11 IS NOT NULL
    AND public.rep_validate_pis_pasep_11_digits(x.pis11)
    AND EXISTS (
      SELECT 1
      FROM generate_series(1, n - 7) g(i)
      WHERE substring(d from g.i for 8) = right(x.pis11, 8)
    )
  ORDER BY u.id
  LIMIT 1;

  RETURN QUERY SELECT v_uid, v_n;
END;
$$;

COMMENT ON FUNCTION public.rep_match_user_weak_pis_sliding(text, text) IS
  'REP fallback: janela 8 dígitos do recebido vs sufixo(8) do PIS válido do colaborador; exige candidato único.';

-- Tiered forte (sem fallback): PIS(DV) → CPF(DV) → identificador/matrícula
CREATE OR REPLACE FUNCTION public.rep_match_user_rep_tiered(
  p_company_id text,
  p_pis_norm text,
  p_cpf_norm text,
  p_matricula_norm text
)
RETURNS TABLE(user_id uuid, match_strategy text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cid text;
  v_n bigint;
  v_uid uuid;
BEGIN
  v_cid := btrim(COALESCE(p_company_id, ''));
  IF v_cid = '' THEN
    RETURN;
  END IF;

  IF p_pis_norm IS NOT NULL
    AND public.rep_validate_pis_pasep_11_digits(p_pis_norm) THEN
    SELECT COUNT(*) INTO v_n
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND public.rep_afd_canonical_11_digits(u.pis_pasep) = p_pis_norm;
    IF v_n = 1 THEN
      SELECT u.id INTO v_uid
      FROM public.users u
      WHERE btrim(u.company_id::text) = v_cid
        AND public.rep_afd_canonical_11_digits(u.pis_pasep) = p_pis_norm
      LIMIT 1;
      RETURN QUERY SELECT v_uid, 'exact_pis'::text;
      RETURN;
    ELSIF v_n > 1 THEN
      RETURN;
    END IF;
  END IF;

  IF p_cpf_norm IS NOT NULL
    AND public.rep_validate_cpf_11_digits(p_cpf_norm) THEN
    SELECT COUNT(*) INTO v_n
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND public.rep_afd_canonical_11_digits(u.cpf) = p_cpf_norm;
    IF v_n = 1 THEN
      SELECT u.id INTO v_uid
      FROM public.users u
      WHERE btrim(u.company_id::text) = v_cid
        AND public.rep_afd_canonical_11_digits(u.cpf) = p_cpf_norm
      LIMIT 1;
      RETURN QUERY SELECT v_uid, 'exact_cpf'::text;
      RETURN;
    ELSIF v_n > 1 THEN
      RETURN;
    END IF;
  END IF;

  IF p_matricula_norm IS NOT NULL AND length(trim(p_matricula_norm)) > 0 THEN
    SELECT COUNT(*) INTO v_n
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND public.rep_matricula_matches_user_fields(p_matricula_norm, u.numero_folha, u.numero_identificador);
    IF v_n = 1 THEN
      SELECT u.id INTO v_uid
      FROM public.users u
      WHERE btrim(u.company_id::text) = v_cid
        AND public.rep_matricula_matches_user_fields(p_matricula_norm, u.numero_folha, u.numero_identificador)
      LIMIT 1;
      RETURN QUERY SELECT v_uid, 'exact_identificador'::text;
      RETURN;
    ELSIF v_n > 1 THEN
      RETURN;
    END IF;
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.rep_match_user_rep_tiered(text, text, text, text) IS
  'REP: PIS(DV válido)→CPF(DV válido)→identificador; >1 candidato na camada → sem match; fallback fora.';

-- RPC browser: match + debug + weak_pis_match
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
  'REP match + debug; PIS forte DV; CPF DV; fallback weak_pis_match (janela 8) só se único; log [REP MATCH RESULT].';

GRANT EXECUTE ON FUNCTION public.rep_match_user_id_for_rep_punch_row(text, text, text, text, jsonb) TO authenticated, service_role;

-- Ingestão: incorpora weak_pis_match para reduzir unresolved
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

    v_user_id := v_user_uuid::text;
    IF v_user_uuid IS NOT NULL AND v_candidates_count = 0 THEN
      v_candidates_count := 1;
    END IF;

    IF v_match_strategy IN ('fallback', 'blob', 'weak_pis_match') AND v_user_uuid IS NOT NULL THEN
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
) IS 'Ingere REP; match tiered forte (PIS/CPF DV) + blob único + weak_pis_match (janela 8) quando único; marca raw_data/confidence e log [REP MATCH RESULT].';

GRANT EXECUTE ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid, boolean
) TO authenticated, service_role;

