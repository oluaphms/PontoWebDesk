-- Quando a primeira batida gravada no dia é uma «entrada» tardia (ex.: 15:03) e depois chega
-- do REP uma «entrada» mais cedo (ex.: 13:51), a sequência civil fica E→E e o trigger bloqueava.
-- Simetria da regra 20260505103000: se há entrada *posterior* no mesmo dia com >5min de intervalo,
-- converte essa linha já persistida em «saída» (mesma heurística de batida duplicada).

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
  v_next_id uuid;
  v_next_inst timestamptz;
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

  -- Tolerância inversa: NEW é entrada *mais cedo*, mas já existe entrada *depois* no espelho (>5min).
  -- Converte a linha posterior (ex.: NSR consolidada primeiro) em saída.
  IF v_t = 'entrada' THEN
    v_next_id := NULL;
    v_next_inst := NULL;
    SELECT tr.id, COALESCE(tr.timestamp, tr.created_at)
    INTO v_next_id, v_next_inst
    FROM public.time_records tr
    WHERE tr.user_id::text = NEW.user_id::text
      AND (COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = v_day
      AND COALESCE(tr.timestamp, tr.created_at) > v_new_inst
      AND public.normalize_time_record_punch_type(tr.type) = 'entrada'
    ORDER BY COALESCE(tr.timestamp, tr.created_at) ASC, tr.id ASC
    LIMIT 1;

    IF v_next_id IS NOT NULL THEN
      v_gap_sec := EXTRACT(EPOCH FROM (v_next_inst - v_new_inst));
      IF v_gap_sec > 300 THEN
        UPDATE public.time_records
        SET
          type = 'saida',
          raw_data = COALESCE(raw_data, '{}'::jsonb)
            || jsonb_build_object(
              'sequence_adjusted', true,
              'sequence_fix', 'posterior_entrada_duplicada_para_saida',
              'sequence_gap_seconds', round(v_gap_sec)::int
            )
        WHERE id = v_next_id;
        RAISE LOG '[CALC FIX] entrada posterior convertida em saída user=% row=% gap_min=%',
          NEW.user_id, v_next_id, (v_gap_sec / 60.0);
      END IF;
    END IF;
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
  'BEFORE INSERT: valida E/P/S; entrada duplicada >5min (antes ou depois no tempo) ajusta tipo; '
  'posterior já gravada pode virar saída quando chega entrada mais cedo (consolidação fora de ordem).';
