-- Jornada noturna REP: data operacional + 4 tipos (entrada/intervalo/saída).


CREATE OR REPLACE FUNCTION public.rep_journey_type_for_position(p_position int)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE GREATEST(COALESCE(p_position, 0), 0)
    WHEN 0 THEN 'entrada'
    WHEN 1 THEN 'intervalo_saida'
    WHEN 2 THEN 'intervalo_volta'
    WHEN 3 THEN 'saida'
    ELSE CASE WHEN p_position % 2 = 0 THEN 'entrada' ELSE 'saida' END
  END;
$$;

CREATE OR REPLACE FUNCTION public.time_record_operational_date_sp(
  p_user_id uuid,
  p_company_id uuid,
  p_instant timestamptz
) RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_civil date;
  v_yesterday date;
  v_js_dow int;
  v_prev_dow int;
  v_time_min int;
  v_shift_start time;
  v_shift_end time;
  v_tol int;
  v_cutoff int;
BEGIN
  v_civil := (p_instant AT TIME ZONE 'America/Sao_Paulo')::date;
  v_yesterday := v_civil - 1;
  v_js_dow := EXTRACT(dow FROM (p_instant AT TIME ZONE 'America/Sao_Paulo'))::int;
  v_prev_dow := CASE WHEN v_js_dow = 0 THEN 6 ELSE v_js_dow - 1 END;
  v_time_min := EXTRACT(HOUR FROM (p_instant AT TIME ZONE 'America/Sao_Paulo'))::int * 60
              + EXTRACT(MINUTE FROM (p_instant AT TIME ZONE 'America/Sao_Paulo'))::int;

  SELECT t.shift_start, t.shift_end, COALESCE(t.tol, 60)
  INTO v_shift_start, v_shift_end, v_tol
  FROM public.ess_day_shift_times(p_user_id, p_company_id::text, v_prev_dow) t
  LIMIT 1;

  IF v_shift_start IS NOT NULL AND v_shift_end IS NOT NULL
     AND public.is_night_shift_schedule(v_shift_start, v_shift_end) THEN
    v_cutoff := public.night_journey_post_midnight_cutoff_minutes(v_shift_start, v_shift_end, v_tol);
    IF v_time_min <= v_cutoff THEN
      RETURN v_yesterday;
    END IF;
  END IF;

  SELECT t.shift_start, t.shift_end, COALESCE(t.tol, 60)
  INTO v_shift_start, v_shift_end, v_tol
  FROM public.ess_day_shift_times(p_user_id, p_company_id::text, v_js_dow) t
  LIMIT 1;

  IF v_shift_start IS NOT NULL AND v_shift_end IS NOT NULL
     AND public.is_night_shift_schedule(v_shift_start, v_shift_end) THEN
    RETURN public.resolve_operational_date_sp(p_instant, v_shift_start, v_shift_end, v_tol);
  END IF;

  RETURN v_civil;
END;
$$;

CREATE OR REPLACE FUNCTION public.rep_existing_types_operational_journey(
  p_user_id uuid,
  p_company_id uuid,
  p_instant timestamptz
) RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(tr.type ORDER BY COALESCE(tr.timestamp, tr.created_at), tr.id),
    ARRAY[]::text[]
  )
  FROM public.time_records tr
  WHERE tr.user_id = p_user_id
    AND tr.company_id = p_company_id
    AND public.time_record_operational_date_sp(
      p_user_id,
      p_company_id,
      COALESCE(tr.timestamp, tr.created_at)
    ) = public.time_record_operational_date_sp(p_user_id, p_company_id, p_instant);
$$;

CREATE OR REPLACE FUNCTION public.rep_resolve_punch_type_operational(
  p_user_id uuid,
  p_company_id uuid,
  p_instant timestamptz,
  p_tipo_marcacao text DEFAULT NULL
) RETURNS TABLE(resolved_type text, is_late boolean)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_marc text;
  v_existing text[];
  v_interp jsonb;
  v_type text;
  v_late boolean := false;
BEGIN
  v_marc := UPPER(LEFT(COALESCE(NULLIF(trim(p_tipo_marcacao), ''), 'E'), 1));
  IF v_marc NOT IN ('E', 'S', 'P', 'B') THEN
    v_marc := 'B';
  END IF;

  IF v_marc IN ('S', 'P')
     AND p_tipo_marcacao IS NOT NULL
     AND trim(p_tipo_marcacao) <> ''
     AND lower(p_tipo_marcacao) NOT IN ('batida', 'b', 'e') THEN
    v_type := CASE v_marc
      WHEN 'S' THEN 'saida'
      WHEN 'P' THEN 'intervalo_saida'
      ELSE 'entrada'
    END;
  ELSE
    v_existing := public.rep_existing_types_operational_journey(p_user_id, p_company_id, p_instant);
    v_interp := public.interpret_punch_by_schedule(p_user_id, p_company_id, p_instant, v_existing);
    v_type := COALESCE(v_interp->>'type', public.rep_journey_type_for_position(COALESCE(array_length(v_existing, 1), 0)));
    v_late := COALESCE((v_interp->>'is_late')::boolean, false);
  END IF;

  resolved_type := replace(replace(lower(trim(v_type)), 'saída', 'saida'), 'pausa', 'intervalo_saida');
  is_late := v_late;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.reclassify_operational_journey_types(
  p_company_id uuid,
  p_user_id uuid,
  p_operational_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_pos int := 0;
  v_updated int := 0;
  v_new_type text;
BEGIN
  PERFORM set_config('ponto.operational_journey_reclassify', '1', true);
  PERFORM set_config('ponto.skip_time_record_sequence_check', '1', true);

  FOR r IN
    SELECT tr.id, tr.type AS old_type
    FROM public.time_records tr
    WHERE tr.company_id = p_company_id
      AND tr.user_id = p_user_id
      AND public.time_record_operational_date_sp(p_user_id, p_company_id, COALESCE(tr.timestamp, tr.created_at)) = p_operational_date
      AND (COALESCE(tr.source, '') = 'rep' OR COALESCE(tr.method, '') ILIKE '%rep%')
    ORDER BY COALESCE(tr.timestamp, tr.created_at), tr.id
  LOOP
    v_new_type := public.rep_journey_type_for_position(v_pos);
    IF r.old_type IS DISTINCT FROM v_new_type THEN
      UPDATE public.time_records
      SET
        type = v_new_type,
        raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object(
          'journey_type_reclassified', true,
          'journey_operational_date', p_operational_date::text,
          'journey_type_position', v_pos,
          'journey_type_before', r.old_type
        )
      WHERE id = r.id;
      v_updated := v_updated + 1;
    END IF;
    v_pos := v_pos + 1;
  END LOOP;

  PERFORM set_config('ponto.skip_time_record_sequence_check', '0', true);
  PERFORM set_config('ponto.operational_journey_reclassify', '0', true);

  RETURN jsonb_build_object('updated', v_updated, 'operational_date', p_operational_date);
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('ponto.skip_time_record_sequence_check', '0', true);
    PERFORM set_config('ponto.operational_journey_reclassify', '0', true);
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclassify_operational_journey_types(uuid, uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.interpret_punch_by_schedule(
  p_employee_id UUID,
  p_company_id UUID,
  p_timestamp TIMESTAMPTZ,
  p_existing_types TEXT[] DEFAULT NULL  -- Tipos já existentes no dia para este funcionário
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_ts TIMESTAMPTZ;
  v_js_dow INT;
  v_day_idx INT;
  v_plan_st TIME;
  v_plan_en TIME;
  v_break_start TIME;
  v_break_end TIME;
  v_tipo_tr TEXT;
  v_existing_count INT;
  v_is_late BOOLEAN := FALSE;
  v_tol INT;
  v_entrada_mins INT;
  v_start_mins INT;
  v_shift_json JSONB;
BEGIN
  -- Contar batidas existentes do dia para determinar a sequência
  v_existing_count := COALESCE(array_length(p_existing_types, 1), 0);
  
  -- Buscar escala do funcionário
  v_local_ts := p_timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_js_dow := DATE_PART('dow', v_local_ts)::int;
  v_day_idx := CASE WHEN v_js_dow = 0 THEN 6 ELSE v_js_dow - 1 END;

  v_shift_json := (
    SELECT jsonb_build_object(
      'st', ws.start_time,
      'en', ws.end_time,
      'bs', ws.break_start_time,
      'be', ws.break_end_time,
      'tol', COALESCE(ws.tolerance_minutes, 0)
    )
    FROM public.employee_shift_schedule ess
    INNER JOIN public.work_shifts ws ON ws.id = ess.shift_id
    WHERE ess.company_id = p_company_id
      AND ess.employee_id = p_employee_id
      AND ess.day_of_week = v_day_idx
      AND COALESCE(ess.is_day_off, false) = false
    LIMIT 1
  );

  IF v_shift_json IS NOT NULL THEN
    v_plan_st := (v_shift_json->>'st')::time;
    v_plan_en := (v_shift_json->>'en')::time;
    v_break_start := (v_shift_json->>'bs')::time;
    v_break_end := (v_shift_json->>'be')::time;
    v_tol := COALESCE((v_shift_json->>'tol')::int, 0);
  ELSE
    v_plan_st := NULL;
    v_plan_en := NULL;
    v_break_start := NULL;
    v_break_end := NULL;
    v_tol := 0;
  END IF;

  -- Se não tem escala configurada, usar lógica padrão por sequência
  IF v_plan_st IS NULL THEN
    v_tipo_tr := public.rep_journey_type_for_position(v_existing_count);
    RETURN jsonb_build_object(
      'type', v_tipo_tr,
      'is_late', FALSE,
      'source', 'sequence_interpretation',
      'existing_count', v_existing_count
    );
  END IF;

  -- Com escala configurada, interpretar baseado no horário
  v_entrada_mins := DATE_PART('hour', v_local_ts)::int * 60 + DATE_PART('minute', v_local_ts)::int;
  
  -- Determinar tipo baseado na sequência e horários da escala (IF em vez de CASE: compatível com SQL Editor)
  IF v_existing_count = 0 THEN
    v_tipo_tr := 'entrada';
    v_start_mins := DATE_PART('hour', v_plan_st)::int * 60 + DATE_PART('minute', v_plan_st)::int;
    v_is_late := v_entrada_mins > (v_start_mins + v_tol);
  ELSIF v_existing_count = 1 THEN
    v_tipo_tr := 'intervalo_saida';
  ELSIF v_existing_count = 2 THEN
    v_tipo_tr := 'intervalo_volta';
  ELSIF v_existing_count = 3 THEN
    v_tipo_tr := 'saida';
  ELSE
    IF v_existing_count % 2 = 0 THEN
      v_tipo_tr := 'entrada';
    ELSE
      v_tipo_tr := 'saída';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'type', v_tipo_tr,
    'is_late', v_is_late,
    'source', 'schedule_interpretation',
    'existing_count', v_existing_count,
    'shift_start', v_plan_st,
    'shift_end', v_plan_en,
    'break_start', v_break_start,
    'break_end', v_break_end
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.time_records_enforce_punch_sequence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_skip text;
  v_day date;
  v_last text;
  v_t text;
  r record;
  v_prev_inst timestamptz;
  v_prev_type text;
  v_gap_sec double precision;
  v_new_inst timestamptz;
  v_n int;
  v_m int;
  v_new_sandwich boolean;
  v_dup_thresh double precision;
  v_rep_like boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  v_skip := NULLIF(trim(COALESCE(current_setting('ponto.skip_time_record_sequence_check', true), '')), '');
  IF v_skip = '1' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_manual, false) THEN
    RETURN NEW;
  END IF;

  v_t := public.normalize_time_record_punch_type(NEW.type);
  IF v_t NOT IN ('entrada', 'saida', 'pausa') THEN
    RETURN NEW;
  END IF;

  v_day := public.time_record_operational_date_sp(NEW.user_id::uuid, NEW.company_id, COALESCE(NEW.timestamp, NEW.created_at, NOW()));
  v_new_inst := COALESCE(NEW.timestamp, NEW.created_at, NOW());

  v_rep_like := COALESCE(NEW.method, '') ILIKE 'rep'
    OR COALESCE(NEW.source, '') ILIKE 'rep'
    OR COALESCE(NEW.source, '') = 'clock';
  v_dup_thresh := CASE WHEN v_rep_like THEN 1::double precision ELSE 45::double precision END;

  IF v_t = 'entrada' THEN
    SELECT
      public.normalize_time_record_punch_type(tr.type),
      COALESCE(tr.timestamp, tr.created_at)
    INTO v_prev_type, v_prev_inst
    FROM public.time_records tr
    WHERE tr.user_id::text = NEW.user_id::text
      AND public.time_record_operational_date_sp(NEW.user_id::uuid, NEW.company_id, COALESCE(tr.timestamp, tr.created_at)) = v_day
      AND COALESCE(tr.timestamp, tr.created_at) < v_new_inst
    ORDER BY COALESCE(tr.timestamp, tr.created_at) DESC, tr.id DESC
    LIMIT 1;

    IF v_prev_type = 'entrada' THEN
      v_gap_sec := EXTRACT(EPOCH FROM (v_new_inst - v_prev_inst));
      IF v_gap_sec > v_dup_thresh THEN
        NEW.type := 'saida';
        NEW.raw_data := COALESCE(NEW.raw_data, '{}'::jsonb)
          || jsonb_build_object(
            'sequence_adjusted', true,
            'sequence_fix', 'entrada_duplicada_para_saida',
            'sequence_gap_seconds', round(v_gap_sec)::int
          );
        v_t := public.normalize_time_record_punch_type(NEW.type);
        RAISE LOG '[CALC FIX] entrada duplicada convertida em saída user=% gap_min=%',
          NEW.user_id, (v_gap_sec / 60.0);
      END IF;
    END IF;
  END IF;

  v_t := public.normalize_time_record_punch_type(NEW.type);

  IF v_t = 'entrada' THEN
    BEGIN
      PERFORM set_config('ponto.time_record_sequence_reconcile', '1', true);
      LOOP
        v_n := 0;
        v_m := 0;

        WITH day_rows AS (
          SELECT
            tr.id::text AS row_pk,
            COALESCE(tr.timestamp, tr.created_at) AS inst,
            public.normalize_time_record_punch_type(tr.type) AS typ,
            tr.id::text AS rid
          FROM public.time_records tr
          WHERE tr.user_id::text = NEW.user_id::text
            AND public.time_record_operational_date_sp(NEW.user_id::uuid, NEW.company_id, COALESCE(tr.timestamp, tr.created_at)) = v_day
          UNION ALL
          SELECT
            NULL::text AS row_pk,
            v_new_inst,
            v_t,
            COALESCE(NEW.id::text, '')
        ),
        ordered AS (
          SELECT
            row_pk,
            inst,
            typ,
            rid,
            lag(typ) OVER (ORDER BY inst ASC, rid ASC) AS prev_typ,
            lag(inst) OVER (ORDER BY inst ASC, rid ASC) AS prev_inst,
            lag(rid) OVER (ORDER BY inst ASC, rid ASC) AS prev_rid
          FROM day_rows
        )
        UPDATE public.time_records tr
        SET
          type = 'saida',
          raw_data = COALESCE(tr.raw_data, '{}'::jsonb)
            || jsonb_build_object(
              'sequence_adjusted', true,
              'sequence_fix', 'posterior_entrada_duplicada_para_saida',
              'sequence_gap_seconds', round(EXTRACT(EPOCH FROM (o.inst - o.prev_inst)))::int
            )
        FROM ordered o
        WHERE tr.id::text = o.row_pk
          AND o.row_pk IS NOT NULL
          AND o.typ = 'entrada'
          AND o.prev_typ = 'entrada'
          AND (
            EXTRACT(EPOCH FROM (o.inst - o.prev_inst)) > v_dup_thresh
            OR (o.inst = o.prev_inst AND o.prev_rid IS NOT NULL AND o.rid > o.prev_rid)
          );

        GET DIAGNOSTICS v_n = ROW_COUNT;

        WITH day_rows AS (
          SELECT
            tr.id::text AS row_pk,
            COALESCE(tr.timestamp, tr.created_at) AS inst,
            public.normalize_time_record_punch_type(tr.type) AS typ,
            tr.id::text AS rid
          FROM public.time_records tr
          WHERE tr.user_id::text = NEW.user_id::text
            AND public.time_record_operational_date_sp(NEW.user_id::uuid, NEW.company_id, COALESCE(tr.timestamp, tr.created_at)) = v_day
          UNION ALL
          SELECT
            NULL::text AS row_pk,
            v_new_inst,
            v_t,
            COALESCE(NEW.id::text, '')
        ),
        ordered AS (
          SELECT
            row_pk,
            inst,
            typ,
            lag(typ) OVER (ORDER BY inst ASC, rid ASC) AS prev_typ,
            lag(inst) OVER (ORDER BY inst ASC, rid ASC) AS prev_inst,
            lead(typ) OVER (ORDER BY inst ASC, rid ASC) AS next_typ
          FROM day_rows
        )
        UPDATE public.time_records tr
        SET
          type = 'saida',
          raw_data = COALESCE(tr.raw_data, '{}'::jsonb)
            || jsonb_build_object(
              'sequence_adjusted', true,
              'sequence_fix', 'entrada_intercalada_duplicada_para_saida',
              'sequence_gap_seconds', round(EXTRACT(EPOCH FROM (o.inst - o.prev_inst)))::int
            )
        FROM ordered o
        WHERE tr.id::text = o.row_pk
          AND o.row_pk IS NOT NULL
          AND o.typ = 'entrada'
          AND o.prev_typ = 'entrada'
          AND o.next_typ = 'entrada'
          AND EXTRACT(EPOCH FROM (o.inst - o.prev_inst)) <= 300;

        GET DIAGNOSTICS v_m = ROW_COUNT;

        IF v_t = 'entrada' AND v_n = 0 AND v_m = 0 THEN
          SELECT EXISTS (
            SELECT 1
            FROM (
              WITH day_rows AS (
                SELECT
                  tr.id::text AS row_pk,
                  COALESCE(tr.timestamp, tr.created_at) AS inst,
                  public.normalize_time_record_punch_type(tr.type) AS typ,
                  tr.id::text AS rid
                FROM public.time_records tr
                WHERE tr.user_id::text = NEW.user_id::text
                  AND public.time_record_operational_date_sp(NEW.user_id::uuid, NEW.company_id, COALESCE(tr.timestamp, tr.created_at)) = v_day
                UNION ALL
                SELECT
                  NULL::text AS row_pk,
                  v_new_inst,
                  v_t,
                  COALESCE(NEW.id::text, '')
              ),
              ordered AS (
                SELECT
                  row_pk,
                  inst,
                  typ,
                  lag(typ) OVER (ORDER BY inst ASC, rid ASC) AS prev_typ,
                  lag(inst) OVER (ORDER BY inst ASC, rid ASC) AS prev_inst,
                  lead(typ) OVER (ORDER BY inst ASC, rid ASC) AS next_typ
                FROM day_rows
              )
              SELECT 1
              FROM ordered o
              WHERE o.row_pk IS NULL
                AND o.typ = 'entrada'
                AND o.prev_typ = 'entrada'
                AND o.next_typ = 'entrada'
                AND EXTRACT(EPOCH FROM (o.inst - o.prev_inst)) <= 300
            ) x
          )
          INTO v_new_sandwich;

          IF v_new_sandwich THEN
            NEW.type := 'saida';
            NEW.raw_data := COALESCE(NEW.raw_data, '{}'::jsonb)
              || jsonb_build_object(
                'sequence_adjusted', true,
                'sequence_fix', 'entrada_intercalada_novo_para_saida'
              );
            EXIT;
          END IF;
        END IF;

        EXIT WHEN v_n = 0 AND v_m = 0;
      END LOOP;
      PERFORM set_config('ponto.time_record_sequence_reconcile', '0', true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('ponto.time_record_sequence_reconcile', '0', true);
      RAISE;
    END;
  END IF;

  v_t := public.normalize_time_record_punch_type(NEW.type);

  v_last := NULL;
  FOR r IN
    SELECT s.inst, s.typ
    FROM (
      SELECT
        COALESCE(tr.timestamp, tr.created_at) AS inst,
        public.normalize_time_record_punch_type(tr.type) AS typ,
        tr.id::text AS rid
      FROM public.time_records tr
      WHERE tr.user_id::text = NEW.user_id::text
        AND public.time_record_operational_date_sp(NEW.user_id::uuid, NEW.company_id, COALESCE(tr.timestamp, tr.created_at)) = v_day
      UNION ALL
      SELECT
        COALESCE(NEW.timestamp, NEW.created_at, NOW()),
        v_t,
        COALESCE(NEW.id::text, '')
    ) s
    WHERE s.typ IN ('entrada', 'saida', 'pausa')
    ORDER BY s.inst ASC, s.rid ASC
  LOOP
    v_t := r.typ;

    IF v_last IS NULL THEN
      IF v_t <> 'entrada' THEN
        RAISE EXCEPTION 'Sequência de ponto inválida: o primeiro registo do dia deve ser entrada.'
          USING ERRCODE = '23514';
      END IF;
      v_last := v_t;
      CONTINUE;
    END IF;

    IF v_last = 'entrada' THEN
      IF v_t IN ('pausa', 'saida') THEN
        v_last := v_t;
        CONTINUE;
      END IF;
      IF v_t = 'entrada' THEN
        RAISE EXCEPTION 'Sequência de ponto inválida: registe intervalo ou saída antes de uma nova entrada.'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF v_last = 'pausa' THEN
      IF v_t = 'entrada' THEN
        v_last := v_t;
        CONTINUE;
      END IF;
      IF v_t = 'pausa' THEN
        RAISE EXCEPTION 'Sequência de ponto inválida: intervalo já iniciado. Finalize o intervalo antes de iniciar outro.'
          USING ERRCODE = '23514';
      END IF;
      IF v_t = 'saida' THEN
        RAISE EXCEPTION 'Sequência de ponto inválida: finalize o intervalo (retorno) antes da saída.'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF v_last = 'saida' THEN
      IF v_t = 'entrada' THEN
        v_last := v_t;
        CONTINUE;
      END IF;
      IF v_t = 'saida' THEN
        RAISE EXCEPTION 'Sequência de ponto inválida: registe entrada antes de uma nova saída.'
          USING ERRCODE = '23514';
      END IF;
      IF v_t = 'pausa' THEN
        RAISE EXCEPTION 'Sequência de ponto inválida: registe entrada antes de iniciar intervalo.'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    v_last := v_t;
  END LOOP;

  RETURN NEW;
END;
$fn$;


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
  v_promote_failed_invalid_sequence int := 0;
  v_promote_failed_rejected int := 0;
  v_skipped int := 0;
  v_skipped_other_user int := 0;
  v_skipped_unresolved int := 0;
  v_windowed boolean;
  v_cid text;
  v_company_uuid uuid;
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
  IF v_cid = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_id obrigatório');
  END IF;
  v_company_uuid := v_cid::uuid;

  v_windowed :=
    p_local_window_start IS NOT NULL
    AND p_local_window_end IS NOT NULL;

  FOR r IN
    SELECT *
    FROM public.rep_punch_logs
    WHERE company_id = v_company_uuid
      AND time_record_id IS NULL
      AND COALESCE(ignored, false) = false
      AND (p_rep_device_id IS NULL OR rep_device_id = p_rep_device_id)
      AND (p_only_rep_punch_log_id IS NULL OR id = p_only_rep_punch_log_id)
      AND (
        NOT v_windowed
        OR (data_hora >= p_local_window_start AND data_hora <= p_local_window_end)
      )
    ORDER BY
      (data_hora AT TIME ZONE 'America/Sao_Paulo')::date ASC,
      resolved_user_id::text NULLS LAST,
      data_hora ASC,
      id ASC
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
      WHERE tr.company_id = v_company_uuid
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
        promotion_status = 'promoted',
        promotion_error_code = NULL,
        promotion_error_message = NULL,
        raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('canonical_user_id', v_user_id)
      WHERE id = r.id;

      RAISE LOG '[REP PROMOTE SUCCESS] %', jsonb_build_object('nsr', r.nsr, 'user_id', v_user_id);
      v_promoted := v_promoted + 1;
      CONTINUE;
    END IF;

    SELECT rt.resolved_type, rt.is_late
    INTO v_tipo_tr, v_is_late
    FROM public.rep_resolve_punch_type_operational(
      v_user_uuid,
      v_company_uuid,
      r.data_hora,
      r.tipo_marcacao
    ) rt;

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
        v_record_id, v_user_uuid, v_company_uuid,
        v_tipo_tr, 'rep', r.data_hora, 'rep', r.nsr, 0, v_is_late
      );

      UPDATE public.rep_punch_logs
      SET
        time_record_id = v_record_id,
        resolved_user_id = COALESCE(resolved_user_id, v_user_id),
        status = 'promoted',
        promotion_status = 'promoted',
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
        last_promotion_attempt_at = NOW(),
        promotion_status = CASE
          WHEN v_err_code = 'invalid_sequence' THEN 'pending_sequence_resolution'
          ELSE 'rejected'
        END
      WHERE id = r.id;

      IF v_err_code = 'invalid_sequence' THEN
        v_promote_failed_invalid_sequence := v_promote_failed_invalid_sequence + 1;
      ELSE
        v_promote_failed_rejected := v_promote_failed_rejected + 1;
      END IF;

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
          ),
          'promotion_status', (
            SELECT promotion_status FROM public.rep_punch_logs WHERE id = r.id LIMIT 1
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

  UPDATE public.rep_punch_logs rp
  SET promotion_status = 'promoted_partial'
  WHERE rp.company_id = v_company_uuid
    AND rp.time_record_id IS NOT NULL
    AND rp.promotion_status = 'promoted'
    AND rp.resolved_user_id IS NOT NULL
    AND (p_rep_device_id IS NULL OR rp.rep_device_id = p_rep_device_id)
    AND EXISTS (
      SELECT 1
      FROM public.rep_punch_logs x
      WHERE x.company_id = v_company_uuid
        AND COALESCE(x.ignored, false) = false
        AND x.time_record_id IS NULL
        AND x.resolved_user_id IS NOT NULL
        AND btrim(x.resolved_user_id::text) = btrim(rp.resolved_user_id::text)
        AND (x.data_hora AT TIME ZONE 'America/Sao_Paulo')::date
          = (rp.data_hora AT TIME ZONE 'America/Sao_Paulo')::date
        AND (p_rep_device_id IS NULL OR x.rep_device_id = p_rep_device_id)
    );

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
    'promote_failed_invalid_sequence', v_promote_failed_invalid_sequence,
    'promote_failed_rejected', v_promote_failed_rejected,
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
  p_trust_client_identity boolean DEFAULT FALSE,
  p_punch_hash text DEFAULT NULL
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
  v_precheck jsonb;
  v_punch_hash text;
BEGIN
  v_cid := btrim(COALESCE(p_company_id, ''));
  v_company_uuid := v_cid::uuid;

  v_precheck := public.rep_ingest_idempotency_precheck(
    p_company_id, p_rep_device_id, p_pis, p_cpf, p_data_hora, p_nsr, p_punch_hash
  );
  IF v_precheck IS NOT NULL THEN
    RETURN v_precheck;
  END IF;

  v_punch_hash := COALESCE(
    NULLIF(btrim(COALESCE(p_punch_hash, '')), ''),
    public.rep_compute_punch_hash(p_rep_device_id, COALESCE(p_pis, p_cpf), p_data_hora, p_nsr)
  );

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
    WHERE company_id = v_company_uuid
      AND nsr = p_nsr
      AND source = 'rep'
      AND dedupe_device = COALESCE(p_rep_device_id::text, '')
    LIMIT 1;
    IF v_dup_log_id IS NOT NULL AND v_dup_time_record_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'inserted', false, 'error', 'NSR já importado', 'rep_log_id', v_dup_log_id, 'punch_hash', v_punch_hash);
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
    v_existing_types := public.rep_existing_types_operational_journey(
      v_user_uuid,
      v_company_uuid,
      p_data_hora
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
    data_hora, tipo_marcacao, nsr, origem, source, raw_data, resolved_user_id, punch_hash
  )
  SELECT
    v_company_uuid,
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
    v_user_id,
    v_punch_hash
  WHERE v_punch_hash IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.rep_punch_logs ex WHERE ex.punch_hash = v_punch_hash
     )
  ON CONFLICT (company_id, nsr, source, dedupe_device) WHERE nsr IS NOT NULL
  DO UPDATE SET
    resolved_user_id = EXCLUDED.resolved_user_id,
    raw_data = EXCLUDED.raw_data
  RETURNING id INTO v_log_id;

  IF v_log_id IS NULL AND v_punch_hash IS NOT NULL THEN
    SELECT id INTO v_log_id FROM public.rep_punch_logs WHERE punch_hash = v_punch_hash LIMIT 1;
    IF v_log_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'inserted', false,
        'idempotent', true,
        'punch_hash', v_punch_hash,
        'rep_log_id', v_log_id,
        'duplicate_reason', 'hash'
      );
    END IF;
  END IF;

  IF p_only_staging THEN
    RETURN jsonb_build_object(
      'success', true,
      'inserted', true,
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
      'inserted', true,
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
      FROM public.ess_day_shift_times(v_user_uuid, v_company_uuid, v_js_dow) t
      LIMIT 1
    );
    v_tol := COALESCE((
      SELECT t.tol
      FROM public.ess_day_shift_times(v_user_uuid, v_company_uuid, v_js_dow) t
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
      v_record_id, v_user_uuid, v_company_uuid,
      v_tipo_tr, 'rep', COALESCE(p_data_hora, NOW()), 'rep', p_nsr, 0, v_is_late
    );
    UPDATE public.rep_punch_logs SET
      time_record_id = v_record_id,
      resolved_user_id = COALESCE(resolved_user_id, v_user_id),
      promotion_error_code = NULL,
      promotion_error_message = NULL
    WHERE id = v_log_id;

    IF p_rep_device_id IS NOT NULL AND v_punch_hash IS NOT NULL THEN
      INSERT INTO public.rep_device_checkpoints (rep_device_id, company_id, last_nsr, last_punch_hash, updated_at)
      VALUES (p_rep_device_id, v_company_uuid, p_nsr, v_punch_hash, NOW())
      ON CONFLICT (rep_device_id) DO UPDATE SET
        last_nsr = EXCLUDED.last_nsr,
        last_punch_hash = EXCLUDED.last_punch_hash,
        updated_at = NOW();
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'inserted', true,
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

