-- Evita segunda tentativa de INSERT no espelho logo após rep_ingest_punch falhar (mesma batida).
-- Ambientes que já aplicaram 20260509120000 sem este bloco recebem o CREATE OR REPLACE aqui.

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
