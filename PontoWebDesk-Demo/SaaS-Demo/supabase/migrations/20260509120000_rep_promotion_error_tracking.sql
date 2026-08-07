-- Rastreio de falhas ao promover REP → time_records: não perder evidência operacional.
-- Colunas em rep_punch_logs + classificação SQL + rep_promote / rep_ingest com EXCEPTION (log mantém-se).

ALTER TABLE public.rep_punch_logs
  ADD COLUMN IF NOT EXISTS promotion_error_code text,
  ADD COLUMN IF NOT EXISTS promotion_error_message text,
  ADD COLUMN IF NOT EXISTS promotion_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_promotion_attempt_at timestamptz;

COMMENT ON COLUMN public.rep_punch_logs.promotion_error_code IS
  'Código estável (ex.: invalid_sequence) quando INSERT em time_records falha; ver rep_classify_promotion_sql_error.';
COMMENT ON COLUMN public.rep_punch_logs.promotion_error_message IS
  'Mensagem Postgres / contexto da última falha de promoção.';
COMMENT ON COLUMN public.rep_punch_logs.promotion_attempts IS
  'Contador de tentativas de promoção ao espelho (incrementa em cada falha).';
COMMENT ON COLUMN public.rep_punch_logs.last_promotion_attempt_at IS
  'Instante da última tentativa de promoção.';

CREATE INDEX IF NOT EXISTS idx_rep_punch_logs_company_promotion_error
  ON public.rep_punch_logs (company_id, promotion_error_code)
  WHERE promotion_error_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rep_punch_logs_company_last_promotion_attempt
  ON public.rep_punch_logs (company_id, last_promotion_attempt_at DESC NULLS LAST);

CREATE OR REPLACE FUNCTION public.rep_classify_promotion_sql_error(p_sqlstate text, p_message text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $c$
  SELECT CASE
    WHEN COALESCE(p_message, '') ILIKE '%Sequência de ponto inválida%'
      OR COALESCE(p_message, '') ILIKE '%sequência de ponto inválida%'
      OR COALESCE(p_sqlstate, '') = '23514'
    THEN 'invalid_sequence'
    WHEN COALESCE(p_message, '') ILIKE '%PERIODO_FECHADO%'
      OR COALESCE(p_message, '') ILIKE '%folha já fechada%'
      OR COALESCE(p_message, '') ILIKE '%período fechado%'
    THEN 'closed_period'
    WHEN COALESCE(p_message, '') ILIKE '%Portaria 671%'
      OR COALESCE(p_message, '') ILIKE '%Alteração de registro de ponto não permitida%'
      OR COALESCE(p_message, '') ILIKE '%não permitida (Portaria%'
    THEN 'protected_timesheet'
    WHEN COALESCE(p_message, '') ILIKE '%NSR já importado%'
      OR COALESCE(p_sqlstate, '') = '23505'
    THEN 'duplicate_nsr'
    WHEN COALESCE(p_message, '') ILIKE '%user_not_found%'
      OR COALESCE(p_message, '') ILIKE '%sem cadastro%'
    THEN 'missing_user'
    ELSE 'unknown'
  END;
$c$;

COMMENT ON FUNCTION public.rep_classify_promotion_sql_error(text, text) IS
  'Mapeia SQLSTATE/mensagem para promotion_error_code estável (alinhado ao TS repPromoteErrorClassifier).';

-- ---------------------------------------------------------------------------
-- rep_promote_pending_rep_punch_logs: por linha, falha de INSERT não aborta o lote
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rep_promote_pending_rep_punch_logs(
  p_company_id text,
  p_rep_device_id uuid DEFAULT NULL,
  p_local_window_start timestamptz DEFAULT NULL,
  p_local_window_end timestamptz DEFAULT NULL,
  p_only_user_id uuid DEFAULT NULL,
  p_only_rep_punch_log_id uuid DEFAULT NULL
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
  v_promote_failed int := 0;
  v_skipped int := 0;
  v_skipped_other_user int := 0;
  v_skipped_unresolved int := 0;
  v_windowed boolean;
  v_cid text;
  v_promoted_detail jsonb := '[]'::jsonb;
  v_failed_detail jsonb := '[]'::jsonb;
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
  v_err_state text;
  v_err_msg text;
  v_err_code text;
  v_prev_promo_err text;
  v_recovered_detail jsonb := '[]'::jsonb;
  v_skip_recent_dup int := 0;
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
      AND (p_only_rep_punch_log_id IS NULL OR id = p_only_rep_punch_log_id)
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
        promotion_error_code = NULL,
        promotion_error_message = NULL,
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

    -- Após rep_ingest_punch falhar no espelho, o cliente chama promote na mesma janela; evita
    -- segundo INSERT idêntico, dupla contagem em promotion_attempts e log enganoso.
    IF r.promotion_error_code IN ('invalid_sequence', 'closed_period', 'duplicate_nsr', 'protected_timesheet')
       AND r.last_promotion_attempt_at IS NOT NULL
       AND r.last_promotion_attempt_at > (clock_timestamp() - INTERVAL '20 seconds')
    THEN
      v_skip_recent_dup := v_skip_recent_dup + 1;
      RAISE LOG '[REP PROMOTE SKIP RECENT DUPLICATE] %', jsonb_build_object(
        'nsr', r.nsr,
        'code', r.promotion_error_code
      );
      CONTINUE;
    END IF;

    SELECT promotion_error_code INTO v_prev_promo_err
    FROM public.rep_punch_logs
    WHERE id = r.id
    LIMIT 1;

    BEGIN
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
        promotion_error_code = NULL,
        promotion_error_message = NULL,
        raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('canonical_user_id', v_user_id)
      WHERE id = r.id;

      IF v_prev_promo_err IS NOT NULL AND btrim(v_prev_promo_err) <> '' THEN
        v_recovered_detail := v_recovered_detail || jsonb_build_array(
          jsonb_build_object(
            'rep_punch_log_id', r.id,
            'nsr', r.nsr,
            'user_id', v_user_id,
            'data_hora', r.data_hora::text,
            'previous_error_code', v_prev_promo_err
          )
        );
      END IF;

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
    EXCEPTION WHEN OTHERS THEN
      v_err_state := SQLSTATE;
      v_err_msg := SQLERRM;
      v_err_code := public.rep_classify_promotion_sql_error(v_err_state, v_err_msg);
      UPDATE public.rep_punch_logs
      SET
        promotion_error_code = v_err_code,
        promotion_error_message = left(v_err_msg, 2000),
        promotion_attempts = COALESCE(promotion_attempts, 0) + 1,
        last_promotion_attempt_at = NOW()
      WHERE id = r.id;

      v_promote_failed := v_promote_failed + 1;
      v_failed_detail := v_failed_detail || jsonb_build_array(
        jsonb_build_object(
          'rep_punch_log_id', r.id,
          'nsr', r.nsr,
          'user_id', v_user_id,
          'data_hora', r.data_hora::text,
          'error_code', v_err_code,
          'message', left(v_err_msg, 2000),
          'sqlstate', v_err_state,
          'promotion_attempts', (
            SELECT promotion_attempts FROM public.rep_punch_logs WHERE id = r.id LIMIT 1
          )
        )
      );
      RAISE LOG '[REP PROMOTE FAILED] %', jsonb_build_object(
        'nsr', r.nsr,
        'user_id', v_user_id,
        'code', v_err_code,
        'message', left(v_err_msg, 500)
      );
    END;
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
    'promote_failed', v_promote_failed,
    'promote_failed_detail', v_failed_detail,
    'promote_skipped_recent_duplicate', v_skip_recent_dup,
    'rep_promote_recovered_detail', v_recovered_detail,
    'skipped_no_user', v_skipped,
    'skipped_other_user', v_skipped_other_user,
    'skipped_unresolved_identity', v_skipped_unresolved,
    'promoted_detail', v_promoted_detail
  );
END;
$$;

COMMENT ON FUNCTION public.rep_promote_pending_rep_punch_logs(text, uuid, timestamptz, timestamptz, uuid, uuid) IS
  'Promove rep_punch_logs; falha por linha regista promotion_error_*; evita retry duplicado <20s após ingest.';

-- rep_ingest_punch: falha no espelho mantém rep_punch_logs e regista erro
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
  v_err_msg text;
  v_err_state text;
  v_err_code text;
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

  BEGIN
    v_record_id := gen_random_uuid()::text;
    INSERT INTO public.time_records (
      id, user_id, company_id, type, method, timestamp, source, nsr, fraud_score, is_late
    ) VALUES (
      v_record_id, v_user_id, p_company_id,
      v_tipo_tr, 'rep', COALESCE(p_data_hora, NOW()), 'rep', p_nsr, 0, v_is_late
    );
    UPDATE public.rep_punch_logs SET
      time_record_id = v_record_id,
      resolved_user_id = COALESCE(resolved_user_id, v_user_id),
      promotion_error_code = NULL,
      promotion_error_message = NULL
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
  EXCEPTION WHEN OTHERS THEN
    v_err_state := SQLSTATE;
    v_err_msg := SQLERRM;
    v_err_code := public.rep_classify_promotion_sql_error(v_err_state, v_err_msg);
    UPDATE public.rep_punch_logs
    SET
      promotion_error_code = v_err_code,
      promotion_error_message = left(v_err_msg, 2000),
      promotion_attempts = COALESCE(promotion_attempts, 0) + 1,
      last_promotion_attempt_at = NOW(),
      time_record_id = NULL
    WHERE id = v_log_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', v_err_msg,
      'promotion_error_code', v_err_code,
      'rep_log_id', v_log_id,
      'user_id', v_user_id,
      'time_record_id', NULL,
      'match_strategy', v_match_strategy,
      'type', v_tipo_tr,
      'promotion_attempts', (
        SELECT promotion_attempts FROM public.rep_punch_logs WHERE id = v_log_id LIMIT 1
      )
    );
  END;
END;
$$;

COMMENT ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid, boolean
) IS 'Ingere REP; falha no espelho mantém rep_punch_logs com promotion_error_* .';

GRANT EXECUTE ON FUNCTION public.rep_classify_promotion_sql_error(text, text) TO authenticated, service_role;
