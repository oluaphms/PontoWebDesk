-- A reconciliação em time_records_enforce_punch_sequence() faz UPDATE (entrada→saída) em linhas já gravadas.
-- O trigger prevent_update_time_records (Portaria 671) bloqueava esses UPDATEs em batidas REP, pelo que a
-- correção nunca aplicava e o INSERT falhava na validação E→E.
--
-- Durante a reconciliação: set_config local + excepção no prevent_update só para patches coerentes
-- (sequence_adjusted, entrada→saída).

CREATE OR REPLACE FUNCTION public.prevent_update_delete_time_records()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manual BOOLEAN;
  v_status_lancamento BOOLEAN;
  v_seq_rec text;
BEGIN
  v_seq_rec := NULLIF(trim(COALESCE(current_setting('ponto.time_record_sequence_reconcile', true), '')), '');

  -- Lançamento de status (folga/falta/extra) pelo app ou RH — deve poder corrigir/excluir.
  v_status_lancamento := COALESCE(OLD.manual_reason, '') ~* '\[STATUS:(FOLGA|FALTA|EXTRA)\]';

  v_manual := COALESCE(OLD.is_manual, false)
    OR COALESCE(OLD.method, '') ILIKE 'admin'
    OR COALESCE(OLD.method, '') ILIKE 'manual'
    OR v_status_lancamento;

  IF TG_OP = 'UPDATE' THEN
    IF v_manual THEN
      RETURN NEW;
    END IF;
    IF v_seq_rec = '1'
      AND NEW.raw_data @> '{"sequence_adjusted": true}'::jsonb
      AND public.normalize_time_record_punch_type(OLD.type) = 'entrada'
      AND public.normalize_time_record_punch_type(NEW.type) = 'saida'
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Alteração de registro de ponto não permitida (Portaria 671). Use time_adjustments para correções.'
      USING ERRCODE = 'check_violation';
  ELSIF TG_OP = 'DELETE' THEN
    IF v_manual THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Exclusão de registro de ponto não permitida (Portaria 671).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.prevent_update_delete_time_records() IS
  'Bloqueia UPDATE/DELETE em batidas REP/app; permite manuais; permite ajuste automático de sequência (GUC ponto.time_record_sequence_reconcile).';

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
    BEGIN
      PERFORM set_config('ponto.time_record_sequence_reconcile', '1', true);
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
  'BEFORE INSERT: valida E/P/S; reconcilia UPDATEs com bypass Portaria 671 via ponto.time_record_sequence_reconcile; '
  'entrada duplicada >5min antes → NEW vira saída; posteriores/sanduíche no espelho ajustam tipo.';
