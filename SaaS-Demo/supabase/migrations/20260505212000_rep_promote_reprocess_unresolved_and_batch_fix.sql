-- REP: reprocessar pendências antigas antes de promover (PIS/CPF/matrícula + weak_pis_match)
-- Objetivo: nenhuma batida fica presa eternamente em rep_punch_logs com resolved_user_id = null.
--
-- Logs:
-- [REP REPROCESS] { nsr, before: null, after: user_id, strategy }
-- [REP PROMOTE SUCCESS] { nsr, user_id }
-- [REP STILL UNRESOLVED] { nsr, reason }
--
-- Performance:
-- - índice company_id + resolved_user_id
-- - processamento em batches com LIMIT

ALTER TABLE public.rep_punch_logs
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

COMMENT ON COLUMN public.rep_punch_logs.status IS
  'Estado de promoção: pending|promoted|skipped. (Compatível com reprocessamento REP).';

CREATE INDEX IF NOT EXISTS idx_rep_punch_logs_company_resolved_user
  ON public.rep_punch_logs(company_id, resolved_user_id)
  WHERE resolved_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rep_punch_logs_company_unresolved_pending
  ON public.rep_punch_logs(company_id, data_hora)
  WHERE resolved_user_id IS NULL AND time_record_id IS NULL;

-- ---------------------------------------------------------------------------
-- Promoção: tenta resolver identidade quando faltar (incl. weak_pis_match)
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
    -- 1) Reprocessar identidade se necessário (mesma lógica da RPC)
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
      ELSE
        RAISE LOG '[REP STILL UNRESOLVED] %', jsonb_build_object(
          'nsr', r.nsr,
          'reason', 'no_match'
        );
        v_skipped_unresolved := v_skipped_unresolved + 1;
        CONTINUE;
      END IF;
    END IF;

    -- Ler resolved_user_id atualizado (pode ter vindo do UPDATE acima)
    v_user_id := btrim(COALESCE(r.resolved_user_id, ''));
    IF v_user_id = '' THEN
      SELECT btrim(COALESCE(resolved_user_id, '')) INTO v_user_id
      FROM public.rep_punch_logs
      WHERE id = r.id
      LIMIT 1;
    END IF;

    IF v_user_id IS NULL OR v_user_id = '' THEN
      v_skipped_unresolved := v_skipped_unresolved + 1;
      CONTINUE;
    END IF;

    v_user_uuid := v_user_id::uuid;

    IF p_only_user_id IS NOT NULL AND v_user_uuid IS DISTINCT FROM p_only_user_id THEN
      v_skipped_other_user := v_skipped_other_user + 1;
      CONTINUE;
    END IF;

    -- 2) Idempotência: se já existe time_record com mesmo NSR na empresa, reaproveitar
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

    -- 3) Promover (inserir em time_records)
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
  'Promove rep_punch_logs; se resolved_user_id nulo tenta rep_match_user_id_for_rep_punch_row (incl. weak_pis_match); idempotente por NSR; logs [REP REPROCESS]/[REP PROMOTE SUCCESS].';

-- ---------------------------------------------------------------------------
-- Reprocessamento em lote: resolve identidade + promove até N linhas
-- ---------------------------------------------------------------------------
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
      v_unresolved := v_unresolved + 1;
      RAISE LOG '[REP STILL UNRESOLVED] %', jsonb_build_object('nsr', r.nsr, 'reason', 'no_match');
      CONTINUE;
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
      || COALESCE(v_m->'raw_data_patch', '{}'::jsonb)
    WHERE id = r.id
      AND (resolved_user_id IS NULL OR btrim(COALESCE(resolved_user_id, '')) = '');

    v_fixed := v_fixed + 1;
    RAISE LOG '[REP REPROCESS] %', jsonb_build_object('nsr', r.nsr, 'before', NULL, 'after', v_user_id, 'strategy', v_strategy);

    -- Promover com idempotência por NSR (se houver)
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
  'Reprocessa em lote: resolved_user_id via rep_match_user_id_for_rep_punch_row e promove para time_records (idempotente por NSR quando existe).';

GRANT EXECUTE ON FUNCTION public.fix_and_promote_pending_rep_punches(uuid, int) TO authenticated, service_role;

