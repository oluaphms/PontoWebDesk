-- Flexibilização: registrar batida sempre; sinalizar inconsistência em raw_data.

CREATE OR REPLACE FUNCTION public.annotate_punch_sequence_inconsistency(
  p_raw_data jsonb,
  p_code text,
  p_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_raw_data, '{}'::jsonb) || jsonb_build_object(
    'sequence_inconsistency', true,
    'sequence_inconsistency_code', p_code,
    'sequence_inconsistency_message', COALESCE(p_message, p_code)
  );
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
  v_is_new boolean;
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
    SELECT s.inst, s.typ, s.is_new
    FROM (
      SELECT
        COALESCE(tr.timestamp, tr.created_at) AS inst,
        public.normalize_time_record_punch_type(tr.type) AS typ,
        tr.id::text AS rid,
        false AS is_new
      FROM public.time_records tr
      WHERE tr.user_id::text = NEW.user_id::text
        AND public.time_record_operational_date_sp(NEW.user_id::uuid, NEW.company_id, COALESCE(tr.timestamp, tr.created_at)) = v_day
      UNION ALL
      SELECT
        COALESCE(NEW.timestamp, NEW.created_at, NOW()),
        v_t,
        COALESCE(NEW.id::text, ''),
        true AS is_new
    ) s
    WHERE s.typ IN ('entrada', 'saida', 'pausa')
    ORDER BY s.inst ASC, s.rid ASC
  LOOP
    v_t := r.typ;
    v_is_new := r.is_new;

    IF v_last IS NULL THEN
      IF v_t <> 'entrada' AND v_is_new THEN
        NEW.raw_data := public.annotate_punch_sequence_inconsistency(NEW.raw_data, CASE v_t WHEN 'pausa' THEN 'INTERVAL_WITHOUT_ENTRY' ELSE 'EXIT_WITHOUT_ENTRY' END, CASE v_t WHEN 'pausa' THEN 'Intervalo sem entrada' ELSE 'Saída sem entrada' END);
      END IF;
      v_last := v_t;
      CONTINUE;
    END IF;

    IF v_last = 'entrada' THEN
      IF v_t IN ('pausa', 'saida') THEN
        v_last := v_t;
        CONTINUE;
      END IF;
      IF v_t = 'entrada' AND v_is_new THEN
        NEW.raw_data := public.annotate_punch_sequence_inconsistency(NEW.raw_data, 'DUPLICATE_ENTRY_WITHOUT_GAP', 'Nova entrada sem intervalo ou saída anterior');
      END IF;
    END IF;

    IF v_last = 'pausa' THEN
      IF v_t = 'entrada' THEN
        v_last := v_t;
        CONTINUE;
      END IF;
      IF v_t = 'pausa' AND v_is_new THEN
        NEW.raw_data := public.annotate_punch_sequence_inconsistency(NEW.raw_data, 'DUPLICATE_INTERVAL_START', 'Intervalo já iniciado');
      END IF;
      IF v_t = 'saida' AND v_is_new THEN
        NEW.raw_data := public.annotate_punch_sequence_inconsistency(NEW.raw_data, 'EXIT_WITHOUT_INTERVAL_RETURN', 'Saída sem retorno de intervalo');
      END IF;
    END IF;

    IF v_last = 'saida' THEN
      IF v_t = 'entrada' THEN
        v_last := v_t;
        CONTINUE;
      END IF;
      IF v_t = 'saida' AND v_is_new THEN
        NEW.raw_data := public.annotate_punch_sequence_inconsistency(NEW.raw_data, 'EXIT_WITHOUT_NEW_ENTRY', 'Saída sem nova entrada');
      END IF;
      IF v_t = 'pausa' AND v_is_new THEN
        NEW.raw_data := public.annotate_punch_sequence_inconsistency(NEW.raw_data, 'INTERVAL_WITHOUT_NEW_ENTRY', 'Intervalo sem nova entrada');
      END IF;
    END IF;

    v_last := v_t;
  END LOOP;

  RETURN NEW;
END;
$fn$;



COMMENT ON FUNCTION public.time_records_enforce_punch_sequence() IS
  'BEFORE INSERT: não bloqueia sequência inválida; marca raw_data para auditoria.';
