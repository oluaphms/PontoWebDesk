-- Na validação sequencial diária (INSERT time_records): se o intervalo já está aberto (`v_last = pausa`)
-- e aparece segunda batida também normalizada como `pausa` com tipo cru `intervalo_saida`,
-- tratar como retorno (equivale a `entrada`). Corrige retorno marcado repetindo `intervalo_saida`
-- por batida física/import — que bloqueava saída final com "finalize (retorno)...".
-- Mantém todas as reconciliações de entradas duplicadas do snapshot 20260508210000.

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
  v_eff text;
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

  v_day := (COALESCE(NEW.timestamp, NEW.created_at, NOW()) AT TIME ZONE 'America/Sao_Paulo')::date;
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
      AND (COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = v_day
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
            AND (COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = v_day
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
            AND (COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = v_day
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
                  AND (COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = v_day
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
    SELECT inst, typ, raw_typ
    FROM (
      SELECT
        COALESCE(tr.timestamp, tr.created_at) AS inst,
        public.normalize_time_record_punch_type(tr.type) AS typ,
        lower(trim(COALESCE(tr.type, ''))) AS raw_typ,
        tr.id::text AS rid
      FROM public.time_records tr
      WHERE tr.user_id::text = NEW.user_id::text
        AND (COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = v_day
      UNION ALL
      SELECT
        COALESCE(NEW.timestamp, NEW.created_at, NOW()),
        v_t,
        lower(trim(COALESCE(NEW.type, ''))),
        COALESCE(NEW.id::text, '')
    ) sq
    WHERE sq.typ IN ('entrada', 'saida', 'pausa')
    ORDER BY sq.inst ASC, sq.rid ASC
  LOOP
    v_eff := r.typ;
    IF v_last = 'pausa' AND r.typ = 'pausa' AND r.raw_typ = 'intervalo_saida' THEN
      v_eff := 'entrada';
    END IF;

    IF v_last IS NULL THEN
      IF v_eff <> 'entrada' THEN
        RAISE EXCEPTION 'Sequência de ponto inválida: o primeiro registo do dia deve ser entrada.'
          USING ERRCODE = '23514';
      END IF;
      v_last := v_eff;
      CONTINUE;
    END IF;

    IF v_last = 'entrada' THEN
      IF v_eff IN ('pausa', 'saida') THEN
        v_last := v_eff;
        CONTINUE;
      END IF;
      IF v_eff = 'entrada' THEN
        RAISE EXCEPTION 'Sequência de ponto inválida: registe intervalo ou saída antes de uma nova entrada.'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF v_last = 'pausa' THEN
      IF v_eff = 'entrada' THEN
        v_last := v_eff;
        CONTINUE;
      END IF;
      IF v_eff = 'pausa' THEN
        RAISE EXCEPTION 'Sequência de ponto inválida: intervalo já iniciado. Finalize o intervalo antes de iniciar outro.'
          USING ERRCODE = '23514';
      END IF;
      IF v_eff = 'saida' THEN
        RAISE EXCEPTION 'Sequência de ponto inválida: finalize o intervalo (retorno) antes da saída.'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    IF v_last = 'saida' THEN
      IF v_eff = 'entrada' THEN
        v_last := v_eff;
        CONTINUE;
      END IF;
      IF v_eff = 'saida' THEN
        RAISE EXCEPTION 'Sequência de ponto inválida: registe entrada antes de uma nova saída.'
          USING ERRCODE = '23514';
      END IF;
      IF v_eff = 'pausa' THEN
        RAISE EXCEPTION 'Sequência de ponto inválida: registe entrada antes de iniciar intervalo.'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    v_last := v_eff;
  END LOOP;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.time_records_enforce_punch_sequence() IS
  'BEFORE INSERT: dupla entrada + reconciliação (Portaria); segundo intervalo_saida com intervalo já aberto → retorno.';
