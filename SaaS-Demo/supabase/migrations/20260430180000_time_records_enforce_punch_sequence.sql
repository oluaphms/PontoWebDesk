-- Validação de sequência de batidas no Postgres (alinhada a validatePunchSequence em timeProcessingService.ts).
-- Dia civil: timezone America/Sao_Paulo.
-- Exceções: batidas manuais (is_manual); ou SET LOCAL ponto.skip_time_record_sequence_check = '1' (migrações/scripts).

CREATE OR REPLACE FUNCTION public.normalize_time_record_punch_type(p_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $norm$
  SELECT CASE lower(trim(COALESCE(p_type, '')))
    WHEN 'saída' THEN 'saida'
    WHEN 'saida' THEN 'saida'
    WHEN 'entrada' THEN 'entrada'
    WHEN 'pausa' THEN 'pausa'
    WHEN 'intervalo_saida' THEN 'pausa'
    WHEN 'intervalo_volta' THEN 'entrada'
    ELSE lower(trim(COALESCE(p_type, '')))
  END;
$norm$;

COMMENT ON FUNCTION public.normalize_time_record_punch_type(text) IS
  'Normaliza tipo de batida para sequência E/P/S (espelho do TS: timeProcessingService.normalizePunchType).';

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
  'BEFORE INSERT: valida sequência entrada → pausa → entrada (retorno) → saída por dia (America/Sao_Paulo). '
  'Ignora se is_manual ou current_setting(''ponto.skip_time_record_sequence_check'', true) = ''1''.';

DROP TRIGGER IF EXISTS tr_time_records_enforce_punch_sequence ON public.time_records;
CREATE TRIGGER tr_time_records_enforce_punch_sequence
  BEFORE INSERT ON public.time_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.time_records_enforce_punch_sequence();
