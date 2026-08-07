-- Índices funcionais em CPF/PIS canónico + match direct_11 em query única (OR usa bitmap sobre os dois índices).
-- rep_match_user_direct_11_digits_unique: um único scan em users (CTE hits).
-- rep_match_user_id_for_rep_punch_row: sem loop por candidato d11.

CREATE INDEX IF NOT EXISTS idx_users_canonical_doc
  ON public.users (public.rep_afd_canonical_11_digits(cpf));

CREATE INDEX IF NOT EXISTS idx_users_canonical_pis
  ON public.users (public.rep_afd_canonical_11_digits(pis_pasep));

COMMENT ON INDEX public.idx_users_canonical_doc IS
  'REP: igualdade em rep_afd_canonical_11_digits(cpf).';
COMMENT ON INDEX public.idx_users_canonical_pis IS
  'REP: igualdade em rep_afd_canonical_11_digits(pis_pasep).';

CREATE OR REPLACE FUNCTION public.rep_match_user_direct_11_first_unique_from_candidates(
  p_company_id text,
  p_candidates text[]
)
RETURNS TABLE(user_id uuid, matched_document text, saw_ambiguous boolean)
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$
  WITH raw AS (
    SELECT
      t.ordinality::int AS ord,
      public.rep_normalize_document_digits(NULLIF(trim(t.x), '')) AS d11
    FROM unnest(COALESCE(p_candidates, ARRAY[]::text[])) WITH ORDINALITY AS t(x, ordinality)
  ),
  filt AS (
    SELECT ord, d11
    FROM raw
    WHERE d11 IS NOT NULL AND length(d11) = 11
  ),
  dedup AS (
    SELECT min(ord) AS ord, d11
    FROM filt
    GROUP BY d11
  ),
  agg AS (
    SELECT
      d.ord,
      d.d11,
      count(DISTINCT u.id) AS n,
      (array_agg(u.id ORDER BY u.id) FILTER (WHERE u.id IS NOT NULL))[1] AS uid
    FROM dedup d
    LEFT JOIN public.users u
      ON btrim(u.company_id::text) = btrim(COALESCE(p_company_id, ''))
      AND btrim(COALESCE(p_company_id, '')) <> ''
      AND (
        public.rep_afd_canonical_11_digits(u.cpf) = d.d11
        OR public.rep_afd_canonical_11_digits(u.pis_pasep) = d.d11
      )
    GROUP BY d.ord, d.d11
  )
  SELECT
    (SELECT a.uid FROM agg a WHERE a.n = 1 ORDER BY a.ord LIMIT 1) AS user_id,
    (SELECT a.d11 FROM agg a WHERE a.n = 1 ORDER BY a.ord LIMIT 1) AS matched_document,
    COALESCE((SELECT bool_or(a.n > 1) FROM agg a), false) AS saw_ambiguous;
$$;

COMMENT ON FUNCTION public.rep_match_user_direct_11_first_unique_from_candidates(text, text[]) IS
  'Primeiro d11 (ordem de entrada) com exactamente 1 colaborador; saw_ambiguous se algum candidato tem >1.';

GRANT EXECUTE ON FUNCTION public.rep_match_user_direct_11_first_unique_from_candidates(text, text[]) TO authenticated, service_role;

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

  WITH hits AS (
    SELECT DISTINCT u.id
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND (
        public.rep_afd_canonical_11_digits(u.cpf) = d
        OR public.rep_afd_canonical_11_digits(u.pis_pasep) = d
      )
  )
  SELECT
    (SELECT count(*)::bigint FROM hits),
    (SELECT h.id FROM hits h ORDER BY h.id LIMIT 1)
  INTO v_n, v_uid;

  IF v_n > 1 THEN
    RAISE LOG '[REP MATCH AMBIGUOUS] %', jsonb_build_object('documento', d, 'candidates', v_n);
    PERFORM public.rep_bump_direct_11_ambiguous_match_metric();
    RETURN;
  END IF;

  IF v_n <> 1 THEN
    RETURN;
  END IF;

  RETURN QUERY SELECT v_uid, v_n;
END;
$$;

COMMENT ON FUNCTION public.rep_match_user_direct_11_digits_unique(text, text) IS
  'REP: match único 11 dígitos; um scan users; índices idx_users_canonical_*; [REP MATCH AMBIGUOUS].';

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
  v_matched_doc text;
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
    SELECT fu.user_id, fu.matched_document
    INTO v_user_uuid, v_matched_doc
    FROM public.rep_match_user_direct_11_first_unique_from_candidates(
      v_cid,
      ARRAY[
        COALESCE(v_pis_norm, ''),
        COALESCE(v_cpf_norm, ''),
        COALESCE(v_pis_any, ''),
        COALESCE(p_pis, ''),
        COALESCE(p_cpf, ''),
        COALESCE(v_id_blob_d, '')
      ]
    ) fu;
    IF v_user_uuid IS NOT NULL THEN
      v_match_strategy := 'direct_11_no_dv';
      v_candidates_count := 1;
      v_raw_patch := COALESCE(v_raw_patch, '{}'::jsonb)
        || jsonb_build_object('match_strategy', v_match_strategy, 'confidence', 'low');
      RAISE LOG '[REP MATCH FALLBACK DIRECT] %',
        jsonb_build_object('documento', v_matched_doc, 'user_id', v_user_uuid);
    END IF;
  END IF;

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
  'REP match + debug; direct_11 via query única (first_unique_from_candidates); usa índices canónicos.';

GRANT EXECUTE ON FUNCTION public.rep_match_user_id_for_rep_punch_row(text, text, text, text, jsonb) TO authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Promoção / ingest (versão batch): substitui loops per-d11 em 06230000.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rep_promote_pending_rep_punch_logs(
  p_company_id text,
  p_rep_device_id uuid DEFAULT NULL,
  p_local_window_start timestamptz DEFAULT NULL,
  p_local_window_end timestamptz DEFAULT NULL,
  p_only_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r record;
  v_user_id text;
  v_user_uuid uuid;
  v_match_strategy text;
  v_record_id text;
  v_existing_record_id text;
  v_tipo_tr text;
  v_js_dow int;
  v_local_ts timestamptz;
  v_sched_entry time;
  v_tol int;
  v_entrada_mins int;
  v_start_mins int;
  v_is_late boolean;
  v_promoted int := 0;
  v_skipped int := 0;
  v_skipped_other_user int := 0;
  v_skipped_unresolved int := 0;
  v_windowed boolean;
  v_cid text;
  v_promoted_detail jsonb := '[]'::jsonb;
  v_m jsonb;
  v_patch jsonb;
  v_promote_line text;
  v_promote_blob text;
  v_promote_blob_d text;
  v_mt_total int := 0;
  v_mt_strong int := 0;
  v_mt_weak int := 0;
  v_mt_direct int := 0;
  v_mt_unres int := 0;
  v_mt_ambig int := 0;
  v_row_ambig boolean;
BEGIN
  PERFORM set_config('statement_timeout', '600s', true);
  v_cid := btrim(COALESCE(p_company_id, ''));

  v_windowed :=
    p_local_window_start IS NOT NULL
    AND p_local_window_end IS NOT NULL;

  FOR r IN
    SELECT *
    FROM public.rep_punch_logs
    WHERE btrim(company_id::text) = v_cid
      AND time_record_id IS NULL
      AND COALESCE(ignored, false) = false
      AND (p_rep_device_id IS NULL OR rep_device_id = p_rep_device_id)
      AND (
        NOT v_windowed
        OR (data_hora >= p_local_window_start AND data_hora <= p_local_window_end)
      )
    ORDER BY data_hora ASC
  LOOP
    v_mt_total := v_mt_total + 1;

    IF r.resolved_user_id IS NULL OR btrim(COALESCE(r.resolved_user_id, '')) = '' THEN
      v_m := public.rep_match_user_id_for_rep_punch_row(
        v_cid,
        r.pis,
        r.cpf,
        r.matricula,
        COALESCE(r.raw_data, '{}'::jsonb)
      );

      IF v_m IS NOT NULL AND NULLIF(btrim(COALESCE(v_m->>'user_id', '')), '') IS NOT NULL THEN
        v_user_id := btrim(v_m->>'user_id');
        v_match_strategy := NULLIF(btrim(COALESCE(v_m->>'match_strategy', '')), '');
        v_patch := v_m->'raw_data_patch';

        UPDATE public.rep_punch_logs
        SET
          resolved_user_id = v_user_id,
          raw_data = (
            COALESCE(raw_data, '{}'::jsonb)
            - 'unresolved'
            - 'unresolved_reason'
          )
          || jsonb_build_object('canonical_user_id', v_user_id)
          || CASE WHEN v_patch IS NOT NULL AND jsonb_typeof(v_patch) = 'object' THEN v_patch ELSE '{}'::jsonb END
        WHERE id = r.id
          AND (resolved_user_id IS NULL OR btrim(COALESCE(resolved_user_id, '')) = '');

        RAISE LOG '[REP REPROCESS] %', jsonb_build_object(
          'nsr', r.nsr,
          'before', NULL,
          'after', v_user_id,
          'strategy', v_match_strategy
        );

        IF v_match_strategy = 'weak_pis_match' THEN
          v_mt_weak := v_mt_weak + 1;
        ELSIF v_match_strategy = 'direct_11_no_dv' THEN
          v_mt_direct := v_mt_direct + 1;
        ELSE
          v_mt_strong := v_mt_strong + 1;
        END IF;
      ELSE
        v_user_uuid := NULL;
        v_user_id := NULL;
        v_match_strategy := NULL;
        v_promote_line := NULL;
        v_promote_blob_d := NULL;
        v_row_ambig := false;
        IF r.raw_data IS NOT NULL AND jsonb_typeof(r.raw_data) = 'object' THEN
          v_promote_line := public.rep_compact_afd_line_from_punch_raw(r.raw_data);
        END IF;
        IF v_promote_line IS NOT NULL THEN
          v_promote_blob := public.rep_afd_identifier_blob_from_compact_line(
            regexp_replace(v_promote_line, '\s', '', 'g')
          );
          IF v_promote_blob IS NOT NULL THEN
            v_promote_blob_d := regexp_replace(v_promote_blob, '\D', '', 'g');
          END IF;
        END IF;

        SELECT f.user_id, f.saw_ambiguous
        INTO v_user_uuid, v_row_ambig
        FROM public.rep_match_user_direct_11_first_unique_from_candidates(
          v_cid,
          ARRAY[
            COALESCE(public.rep_afd_canonical_11_digits(r.pis), ''),
            COALESCE(public.rep_afd_canonical_11_digits(r.cpf), ''),
            COALESCE(NULLIF(trim(r.pis), ''), ''),
            COALESCE(NULLIF(trim(r.cpf), ''), ''),
            COALESCE(v_promote_blob_d, ''),
            CASE WHEN v_promote_blob_d IS NOT NULL AND length(v_promote_blob_d) >= 11 THEN substring(v_promote_blob_d from 1 for 11) END,
            CASE WHEN v_promote_blob_d IS NOT NULL AND length(v_promote_blob_d) > 11 THEN substring(v_promote_blob_d from length(v_promote_blob_d) - 10 for 11) END
          ]
        ) f;

        IF v_user_uuid IS NOT NULL THEN
          v_user_id := v_user_uuid::text;
          v_match_strategy := 'direct_11_no_dv';
          v_mt_direct := v_mt_direct + 1;
          UPDATE public.rep_punch_logs
          SET
            resolved_user_id = v_user_id,
            raw_data = (
              COALESCE(raw_data, '{}'::jsonb)
              - 'unresolved'
              - 'unresolved_reason'
            )
            || jsonb_build_object(
              'canonical_user_id', v_user_id,
              'match_strategy', 'direct_11_no_dv',
              'matched_user_id', v_user_id,
              'confidence', 'low',
              'promote_force_match', true
            )
          WHERE id = r.id
            AND (resolved_user_id IS NULL OR btrim(COALESCE(resolved_user_id, '')) = '');

          RAISE LOG '[REP INGEST FORCE MATCH] %', jsonb_build_object('nsr', r.nsr, 'resolved_user_id', v_user_id);
          RAISE LOG '[REP REPROCESS] %', jsonb_build_object(
            'nsr', r.nsr,
            'before', NULL,
            'after', v_user_id,
            'strategy', v_match_strategy
          );
        ELSE
          RAISE LOG '[REP STILL UNRESOLVED] %', jsonb_build_object(
            'nsr', r.nsr,
            'reason', 'no_match'
          );
          v_skipped_unresolved := v_skipped_unresolved + 1;
          v_mt_unres := v_mt_unres + 1;
          IF v_row_ambig THEN
            v_mt_ambig := v_mt_ambig + 1;
          END IF;
          CONTINUE;
        END IF;
      END IF;
    END IF;

    v_user_id := btrim(COALESCE(r.resolved_user_id, ''));
    IF v_user_id = '' THEN
      SELECT btrim(COALESCE(resolved_user_id, '')) INTO v_user_id
      FROM public.rep_punch_logs
      WHERE id = r.id
      LIMIT 1;
    END IF;

    IF v_user_id IS NULL OR v_user_id = '' THEN
      v_skipped_unresolved := v_skipped_unresolved + 1;
      v_mt_unres := v_mt_unres + 1;
      CONTINUE;
    END IF;

    v_user_uuid := v_user_id::uuid;

    IF p_only_user_id IS NOT NULL AND v_user_uuid IS DISTINCT FROM p_only_user_id THEN
      v_skipped_other_user := v_skipped_other_user + 1;
      CONTINUE;
    END IF;

    v_existing_record_id := NULL;
    IF r.nsr IS NOT NULL THEN
      SELECT tr.id::text INTO v_existing_record_id
      FROM public.time_records tr
      WHERE tr.company_id = v_cid
        AND tr.nsr = r.nsr
        AND tr.source = 'rep'
      LIMIT 1;
    END IF;

    IF v_existing_record_id IS NOT NULL THEN
      UPDATE public.rep_punch_logs
      SET
        time_record_id = v_existing_record_id,
        resolved_user_id = COALESCE(resolved_user_id, v_user_id),
        status = 'promoted',
        raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('canonical_user_id', v_user_id)
      WHERE id = r.id;

      RAISE LOG '[REP PROMOTE SUCCESS] %', jsonb_build_object('nsr', r.nsr, 'user_id', v_user_id);
      v_promoted := v_promoted + 1;
      CONTINUE;
    END IF;

    v_tipo_tr := CASE UPPER(LEFT(COALESCE(r.tipo_marcacao, 'E'), 1))
      WHEN 'E' THEN 'entrada'
      WHEN 'S' THEN 'saída'
      WHEN 'P' THEN 'pausa'
      ELSE 'entrada'
    END;

    v_is_late := FALSE;
    IF v_tipo_tr = 'entrada' AND v_user_uuid IS NOT NULL THEN
      v_local_ts := r.data_hora AT TIME ZONE 'America/Sao_Paulo';
      v_js_dow := DATE_PART('dow', v_local_ts)::int;
      v_sched_entry := NULL;
      v_tol := 0;
      v_sched_entry := (
        SELECT t.shift_start
        FROM public.ess_day_shift_times(v_user_uuid, v_cid, v_js_dow) t
        LIMIT 1
      );
      v_tol := COALESCE((
        SELECT t.tol
        FROM public.ess_day_shift_times(v_user_uuid, v_cid, v_js_dow) t
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
      v_record_id, v_user_id, v_cid,
      v_tipo_tr, 'rep', r.data_hora, 'rep', r.nsr, 0, v_is_late
    );

    UPDATE public.rep_punch_logs
    SET
      time_record_id = v_record_id,
      resolved_user_id = COALESCE(resolved_user_id, v_user_id),
      status = 'promoted',
      raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('canonical_user_id', v_user_id)
    WHERE id = r.id;

    RAISE LOG '[REP PROMOTE SUCCESS] %', jsonb_build_object('nsr', r.nsr, 'user_id', v_user_id);
    v_promoted := v_promoted + 1;

    v_promoted_detail := v_promoted_detail || jsonb_build_array(
      jsonb_build_object(
        'nsr', r.nsr,
        'user_id', v_user_id,
        'data_hora', r.data_hora::text,
        'status', 'promoted'
      )
    );
  END LOOP;

  IF v_mt_total > 0 THEN
    PERFORM public.rep_emit_rep_match_metrics(
      'promote',
      v_cid,
      v_mt_total,
      v_mt_strong,
      v_mt_weak,
      v_mt_direct,
      v_mt_unres,
      v_mt_ambig
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'promoted', v_promoted,
    'skipped_no_user', v_skipped,
    'skipped_other_user', v_skipped_other_user,
    'skipped_unresolved_identity', v_skipped_unresolved,
    'promoted_detail', v_promoted_detail
  );
END;
$$;

COMMENT ON FUNCTION public.rep_promote_pending_rep_punch_logs(text, uuid, timestamptz, timestamptz, uuid) IS
  'Promove rep_punch_logs; RPC + direct_11; [REP MATCH METRICS] por lote.';

GRANT EXECUTE ON FUNCTION public.rep_promote_pending_rep_punch_logs(text, uuid, timestamptz, timestamptz, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fix_and_promote_pending_rep_punches(
  p_company_id uuid,
  p_limit int DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r record;
  v_cid text;
  v_lim int;
  v_processed int := 0;
  v_fixed int := 0;
  v_promoted int := 0;
  v_unresolved int := 0;
  v_m jsonb;
  v_user_id text;
  v_strategy text;
  v_record_id text;
  v_existing_record_id text;
  v_user_uuid uuid;
  v_d11 text;
  v_promote_line text;
  v_promote_blob text;
  v_promote_blob_d text;
  v_mt_total int := 0;
  v_mt_strong int := 0;
  v_mt_weak int := 0;
  v_mt_direct int := 0;
  v_mt_unres int := 0;
  v_mt_ambig int := 0;
  v_row_ambig boolean;
BEGIN
  v_cid := btrim(p_company_id::text);
  v_lim := GREATEST(1, LEAST(COALESCE(p_limit, 200), 5000));

  FOR r IN
    SELECT id, nsr, pis, cpf, matricula, data_hora, tipo_marcacao, raw_data, resolved_user_id
    FROM public.rep_punch_logs
    WHERE btrim(company_id::text) = v_cid
      AND time_record_id IS NULL
      AND COALESCE(ignored, false) = false
      AND (resolved_user_id IS NULL OR btrim(COALESCE(resolved_user_id, '')) = '')
    ORDER BY data_hora ASC
    LIMIT v_lim
  LOOP
    v_processed := v_processed + 1;
    v_mt_total := v_mt_total + 1;
    v_row_ambig := false;

    v_m := public.rep_match_user_id_for_rep_punch_row(
      v_cid,
      r.pis,
      r.cpf,
      r.matricula,
      COALESCE(r.raw_data, '{}'::jsonb)
    );

    v_user_id := NULLIF(btrim(COALESCE(v_m->>'user_id', '')), '');
    v_strategy := NULLIF(btrim(COALESCE(v_m->>'match_strategy', '')), '');

    IF v_user_id IS NULL THEN
      v_user_uuid := NULL;
      v_promote_line := NULL;
      v_promote_blob_d := NULL;
      IF r.raw_data IS NOT NULL AND jsonb_typeof(r.raw_data) = 'object' THEN
        v_promote_line := public.rep_compact_afd_line_from_punch_raw(r.raw_data);
      END IF;
      IF v_promote_line IS NOT NULL THEN
        v_promote_blob := public.rep_afd_identifier_blob_from_compact_line(
          regexp_replace(v_promote_line, '\s', '', 'g')
        );
        IF v_promote_blob IS NOT NULL THEN
          v_promote_blob_d := regexp_replace(v_promote_blob, '\D', '', 'g');
        END IF;
      END IF;

      SELECT f.user_id, f.saw_ambiguous
      INTO v_user_uuid, v_row_ambig
      FROM public.rep_match_user_direct_11_first_unique_from_candidates(
        v_cid,
        ARRAY[
          COALESCE(public.rep_afd_canonical_11_digits(r.pis), ''),
          COALESCE(public.rep_afd_canonical_11_digits(r.cpf), ''),
          COALESCE(NULLIF(trim(r.pis), ''), ''),
          COALESCE(NULLIF(trim(r.cpf), ''), ''),
          COALESCE(v_promote_blob_d, ''),
          CASE WHEN v_promote_blob_d IS NOT NULL AND length(v_promote_blob_d) >= 11 THEN substring(v_promote_blob_d from 1 for 11) END,
          CASE WHEN v_promote_blob_d IS NOT NULL AND length(v_promote_blob_d) > 11 THEN substring(v_promote_blob_d from length(v_promote_blob_d) - 10 for 11) END
        ]
      ) f;

      IF v_user_uuid IS NOT NULL THEN
        v_user_id := v_user_uuid::text;
        v_strategy := 'direct_11_no_dv';
        RAISE LOG '[REP INGEST FORCE MATCH] %', jsonb_build_object('nsr', r.nsr, 'resolved_user_id', v_user_id);
      END IF;
    END IF;

    IF v_user_id IS NULL THEN
      v_unresolved := v_unresolved + 1;
      v_mt_unres := v_mt_unres + 1;
      IF v_row_ambig THEN
        v_mt_ambig := v_mt_ambig + 1;
      END IF;
      RAISE LOG '[REP STILL UNRESOLVED] %', jsonb_build_object('nsr', r.nsr, 'reason', 'no_match');
      CONTINUE;
    END IF;

    IF v_strategy = 'weak_pis_match' THEN
      v_mt_weak := v_mt_weak + 1;
    ELSIF v_strategy = 'direct_11_no_dv' THEN
      v_mt_direct := v_mt_direct + 1;
    ELSE
      v_mt_strong := v_mt_strong + 1;
    END IF;

    UPDATE public.rep_punch_logs
    SET
      resolved_user_id = v_user_id,
      raw_data = (
        COALESCE(raw_data, '{}'::jsonb)
        - 'unresolved'
        - 'unresolved_reason'
      )
      || jsonb_build_object('canonical_user_id', v_user_id)
      || CASE
        WHEN v_strategy = 'direct_11_no_dv' THEN jsonb_build_object(
          'match_strategy', 'direct_11_no_dv',
          'matched_user_id', v_user_id,
          'confidence', 'low',
          'promote_force_match', true
        )
        ELSE COALESCE(v_m->'raw_data_patch', '{}'::jsonb)
      END
    WHERE id = r.id
      AND (resolved_user_id IS NULL OR btrim(COALESCE(resolved_user_id, '')) = '');

    v_fixed := v_fixed + 1;
    RAISE LOG '[REP REPROCESS] %', jsonb_build_object('nsr', r.nsr, 'before', NULL, 'after', v_user_id, 'strategy', v_strategy);

    v_existing_record_id := NULL;
    IF r.nsr IS NOT NULL THEN
      SELECT tr.id::text INTO v_existing_record_id
      FROM public.time_records tr
      WHERE tr.company_id = v_cid
        AND tr.nsr = r.nsr
        AND tr.source = 'rep'
      LIMIT 1;
    END IF;

    IF v_existing_record_id IS NOT NULL THEN
      UPDATE public.rep_punch_logs
      SET
        time_record_id = v_existing_record_id,
        status = 'promoted'
      WHERE id = r.id
        AND time_record_id IS NULL;
      v_promoted := v_promoted + 1;
      RAISE LOG '[REP PROMOTE SUCCESS] %', jsonb_build_object('nsr', r.nsr, 'user_id', v_user_id);
      CONTINUE;
    END IF;

    v_record_id := gen_random_uuid()::text;
    INSERT INTO public.time_records (
      id, user_id, company_id, type, method, timestamp, source, nsr, fraud_score, is_late
    ) VALUES (
      v_record_id,
      v_user_id,
      v_cid,
      CASE UPPER(LEFT(COALESCE(r.tipo_marcacao, 'E'), 1))
        WHEN 'E' THEN 'entrada'
        WHEN 'S' THEN 'saída'
        WHEN 'P' THEN 'pausa'
        ELSE 'entrada'
      END,
      'rep',
      r.data_hora,
      'rep',
      r.nsr,
      0,
      FALSE
    );

    UPDATE public.rep_punch_logs
    SET
      time_record_id = v_record_id,
      status = 'promoted'
    WHERE id = r.id
      AND time_record_id IS NULL;

    v_promoted := v_promoted + 1;
    RAISE LOG '[REP PROMOTE SUCCESS] %', jsonb_build_object('nsr', r.nsr, 'user_id', v_user_id);
  END LOOP;

  IF v_mt_total > 0 THEN
    PERFORM public.rep_emit_rep_match_metrics(
      'fix_and_promote',
      v_cid,
      v_mt_total,
      v_mt_strong,
      v_mt_weak,
      v_mt_direct,
      v_mt_unres,
      v_mt_ambig
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'fixed', v_fixed,
    'promoted', v_promoted,
    'still_unresolved', v_unresolved,
    'batch_limit', v_lim
  );
END;
$$;

COMMENT ON FUNCTION public.fix_and_promote_pending_rep_punches(uuid, int) IS
  'Lote: RPC + direct_11; [REP MATCH METRICS] por lote.';

GRANT EXECUTE ON FUNCTION public.fix_and_promote_pending_rep_punches(uuid, int) TO authenticated, service_role;

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
  v_matched_d11 text;
  v_tmp_ambig boolean;
  v_ingest_ambiguous boolean := false;
  v_mi_s int := 0;
  v_mi_w int := 0;
  v_mi_d int := 0;
  v_mi_u int := 0;
  v_mi_a int := 0;
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
      SELECT fu.user_id, fu.matched_document, fu.saw_ambiguous
      INTO v_user_uuid, v_matched_d11, v_tmp_ambig
      FROM public.rep_match_user_direct_11_first_unique_from_candidates(
        v_cid,
        ARRAY[
          COALESCE(v_pis_norm, ''),
          COALESCE(v_cpf_norm, ''),
          COALESCE(v_pis_any, ''),
          COALESCE(p_pis, ''),
          COALESCE(p_cpf, ''),
          COALESCE(v_id_blob_d, ''),
          CASE WHEN v_id_blob_d IS NOT NULL AND length(v_id_blob_d) >= 11 THEN substring(v_id_blob_d from 1 for 11) END,
          CASE WHEN v_id_blob_d IS NOT NULL AND length(v_id_blob_d) > 11 THEN substring(v_id_blob_d from length(v_id_blob_d) - 10 for 11) END
        ]
      ) fu;
      v_ingest_ambiguous := v_ingest_ambiguous OR COALESCE(v_tmp_ambig, false);
      IF v_user_uuid IS NOT NULL THEN
        v_match_strategy := 'direct_11_no_dv';
        v_candidates_count := 1;
        RAISE LOG '[REP MATCH FALLBACK DIRECT] %',
          jsonb_build_object('documento', v_matched_d11, 'user_id', v_user_uuid);
      END IF;
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
    SELECT fu.user_id, fu.matched_document, fu.saw_ambiguous
    INTO v_user_uuid, v_matched_d11, v_tmp_ambig
    FROM public.rep_match_user_direct_11_first_unique_from_candidates(
      v_cid,
      ARRAY[
        COALESCE(v_pis_norm, ''),
        COALESCE(v_cpf_norm, ''),
        COALESCE(v_pis_any, ''),
        COALESCE(p_pis, ''),
        COALESCE(p_cpf, ''),
        COALESCE(v_id_blob_d, ''),
        CASE WHEN v_id_blob_d IS NOT NULL AND length(v_id_blob_d) >= 11 THEN substring(v_id_blob_d from 1 for 11) END,
        CASE WHEN v_id_blob_d IS NOT NULL AND length(v_id_blob_d) > 11 THEN substring(v_id_blob_d from length(v_id_blob_d) - 10 for 11) END
      ]
    ) fu;
    v_ingest_ambiguous := v_ingest_ambiguous OR COALESCE(v_tmp_ambig, false);
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
    END IF;
  END IF;

  v_mi_a := CASE WHEN v_ingest_ambiguous THEN 1 ELSE 0 END;
  IF v_user_id IS NULL THEN
    v_mi_u := 1;
  ELSIF p_force_user_id IS NOT NULL THEN
    v_mi_s := 1;
  ELSIF v_match_strategy = 'weak_pis_match' THEN
    v_mi_w := 1;
  ELSIF v_match_strategy = 'direct_11_no_dv' THEN
    v_mi_d := 1;
  ELSE
    v_mi_s := 1;
  END IF;
  PERFORM public.rep_emit_rep_match_metrics('ingest', v_cid, 1, v_mi_s, v_mi_w, v_mi_d, v_mi_u, v_mi_a);

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
) IS 'Ingere REP; direct_11 em query única; idx_users_canonical_*; [REP MATCH METRICS].';

GRANT EXECUTE ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid, boolean
) TO authenticated, service_role;
