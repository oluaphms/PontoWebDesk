-- Reforço de 20260508160000: reconciliar *em cadeia* entradas duplicadas no mesmo dia civil
-- quando a descarga chega fora de ordem ou há batidas «no meio» (E–E curto + E posterior).
-- (A) Dois E consecutivos no tempo civil com >5 min → o segundo persistido vira saída (repetir até estabilizar).
-- (B) E–E–E com intervalo entre o 1.º e o 2.º ≤5 min → o do meio (persistido) vira saída (fila/NSR apertados).

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

  -- Tolerância: segunda entrada após entrada anterior (no tempo) → NEW vira saída se > 5 minutos
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
      IF v_gap_sec > 300 THEN
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

  -- Alinhar espelho ao novo INSERT: corrigir linhas já gravadas até a sequência civil ficar válida
  IF v_t = 'entrada' THEN
    LOOP
      v_n := 0;
      v_m := 0;

      WITH day_rows AS (
        SELECT
          tr.id,
          COALESCE(tr.timestamp, tr.created_at) AS inst,
          public.normalize_time_record_punch_type(tr.type) AS typ,
          tr.id::text AS rid
        FROM public.time_records tr
        WHERE tr.user_id::text = NEW.user_id::text
          AND (COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = v_day
        UNION ALL
        SELECT
          NULL::uuid,
          v_new_inst,
          v_t,
          COALESCE(NEW.id::text, '')
      ),
      ordered AS (
        SELECT
          id,
          inst,
          typ,
          lag(typ) OVER (ORDER BY inst ASC, rid ASC) AS prev_typ,
          lag(inst) OVER (ORDER BY inst ASC, rid ASC) AS prev_inst
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
      WHERE tr.id = o.id
        AND o.id IS NOT NULL
        AND o.typ = 'entrada'
        AND o.prev_typ = 'entrada'
        AND EXTRACT(EPOCH FROM (o.inst - o.prev_inst)) > 300;

      GET DIAGNOSTICS v_n = ROW_COUNT;

      WITH day_rows AS (
        SELECT
          tr.id,
          COALESCE(tr.timestamp, tr.created_at) AS inst,
          public.normalize_time_record_punch_type(tr.type) AS typ,
          tr.id::text AS rid
        FROM public.time_records tr
        WHERE tr.user_id::text = NEW.user_id::text
          AND (COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = v_day
        UNION ALL
        SELECT
          NULL::uuid,
          v_new_inst,
          v_t,
          COALESCE(NEW.id::text, '')
      ),
      ordered AS (
        SELECT
          id,
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
      WHERE tr.id = o.id
        AND o.id IS NOT NULL
        AND o.typ = 'entrada'
        AND o.prev_typ = 'entrada'
        AND o.next_typ = 'entrada'
        AND EXTRACT(EPOCH FROM (o.inst - o.prev_inst)) <= 300;

      GET DIAGNOSTICS v_m = ROW_COUNT;

      -- Meio do sanduíche é o próprio NEW (ainda sem id): só dá para ajustar no registo em inserção.
      IF v_t = 'entrada' AND v_n = 0 AND v_m = 0 THEN
        SELECT EXISTS (
          SELECT 1
          FROM (
            WITH day_rows AS (
              SELECT
                tr.id,
                COALESCE(tr.timestamp, tr.created_at) AS inst,
                public.normalize_time_record_punch_type(tr.type) AS typ,
                tr.id::text AS rid
              FROM public.time_records tr
              WHERE tr.user_id::text = NEW.user_id::text
                AND (COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = v_day
              UNION ALL
              SELECT
                NULL::uuid,
                v_new_inst,
                v_t,
                COALESCE(NEW.id::text, '')
            ),
            ordered AS (
              SELECT
                id,
                inst,
                typ,
                lag(typ) OVER (ORDER BY inst ASC, rid ASC) AS prev_typ,
                lag(inst) OVER (ORDER BY inst ASC, rid ASC) AS prev_inst,
                lead(typ) OVER (ORDER BY inst ASC, rid ASC) AS next_typ
              FROM day_rows
            )
            SELECT 1
            FROM ordered o
            WHERE o.id IS NULL
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
        AND (COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = v_day
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

COMMENT ON FUNCTION public.time_records_enforce_punch_sequence() IS
  'BEFORE INSERT: valida E/P/S; entrada duplicada >5min antes → NEW vira saída; '
  'com NEW entrada, reconcilia linhas já gravadas (posterior >5min e sanduíche E–E–E ≤5min) para descarga fora de ordem.';
