-- 039 - Compatibilidade de bootstrap para work_shifts/schedules
-- Evita assumir entry_time/exit_time quando o schema usa start_time/end_time.

BEGIN;

CREATE OR REPLACE FUNCTION public._pwd_company_param_ref_local(p_table text, p_ref text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_udt text;
BEGIN
  SELECT udt_name INTO v_udt
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = p_table
     AND column_name = 'company_id';

  IF v_udt = 'uuid' THEN
    RETURN p_ref || '::uuid';
  END IF;
  RETURN p_ref || '::text';
END;
$$;

CREATE OR REPLACE FUNCTION public.pwd_bootstrap_company_defaults(p_company_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id text := btrim(COALESCE(p_company_id, ''));
  v_shift_id uuid;
  v_sql text;
  v_columns text[];
  v_values text[];
BEGIN
  IF v_company_id = '' THEN
    RETURN;
  END IF;

  IF to_regclass('public.work_shifts') IS NOT NULL THEN
    SELECT id INTO v_shift_id
      FROM public.work_shifts
     WHERE company_id::text = v_company_id
       AND name IN ('Jornada 44h Semanais', 'Segunda a Sexta', 'Comercial')
     ORDER BY created_at NULLS LAST, id
     LIMIT 1;

    IF v_shift_id IS NULL THEN
      v_columns := ARRAY['company_id', 'name'];
      v_values := ARRAY[public._pwd_company_param_ref_local('work_shifts', '$1'), '$2'];

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'start_time'
      ) THEN
        v_columns := array_append(v_columns, 'start_time');
        v_values := array_append(v_values, '$3::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'end_time'
      ) THEN
        v_columns := array_append(v_columns, 'end_time');
        v_values := array_append(v_values, '$4::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'entry_time'
      ) THEN
        v_columns := array_append(v_columns, 'entry_time');
        v_values := array_append(v_values, '$3::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'exit_time'
      ) THEN
        v_columns := array_append(v_columns, 'exit_time');
        v_values := array_append(v_values, '$4::time');
      END IF;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'break_start'
      ) THEN
        v_columns := array_append(v_columns, 'break_start');
        v_values := array_append(v_values, '''12:00''::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'break_end'
      ) THEN
        v_columns := array_append(v_columns, 'break_end');
        v_values := array_append(v_values, '''13:00''::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'break_start_time'
      ) THEN
        v_columns := array_append(v_columns, 'break_start_time');
        v_values := array_append(v_values, '''12:00''::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'break_end_time'
      ) THEN
        v_columns := array_append(v_columns, 'break_end_time');
        v_values := array_append(v_values, '''13:00''::time');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'break_duration'
      ) THEN
        v_columns := array_append(v_columns, 'break_duration');
        v_values := array_append(v_values, '60');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'break_minutes'
      ) THEN
        v_columns := array_append(v_columns, 'break_minutes');
        v_values := array_append(v_values, '60');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'tolerance_minutes'
      ) THEN
        v_columns := array_append(v_columns, 'tolerance_minutes');
        v_values := array_append(v_values, '10');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'active'
      ) THEN
        v_columns := array_append(v_columns, 'active');
        v_values := array_append(v_values, 'true');
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'work_shifts' AND column_name = 'ativo'
      ) THEN
        v_columns := array_append(v_columns, 'ativo');
        v_values := array_append(v_values, 'true');
      END IF;

      v_sql := format(
        'INSERT INTO public.work_shifts (%s) VALUES (%s) RETURNING id',
        array_to_string(v_columns, ', '),
        array_to_string(v_values, ', ')
      );
      EXECUTE v_sql USING v_company_id, 'Jornada 44h Semanais', '08:00', '18:00' INTO v_shift_id;
    END IF;
  END IF;

  IF to_regclass('public.schedules') IS NOT NULL AND v_shift_id IS NOT NULL THEN
    v_columns := ARRAY['company_id', 'name', 'days', 'shift_id'];
    v_values := ARRAY[
      public._pwd_company_param_ref_local('schedules', '$1'),
      '$2',
      'ARRAY[1,2,3,4,5]::integer[]',
      '$3'
    ];

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'schedules' AND column_name = 'ativo'
    ) THEN
      v_columns := array_append(v_columns, 'ativo');
      v_values := array_append(v_values, 'true');
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'schedules' AND column_name = 'tipo'
    ) THEN
      v_columns := array_append(v_columns, 'tipo');
      v_values := array_append(v_values, '''FIXA''');
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'schedules' AND column_name = 'dias_trabalho'
    ) THEN
      v_columns := array_append(v_columns, 'dias_trabalho');
      v_values := array_append(v_values, '5');
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'schedules' AND column_name = 'dias_folga'
    ) THEN
      v_columns := array_append(v_columns, 'dias_folga');
      v_values := array_append(v_values, '2');
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'schedules' AND column_name = 'descricao'
    ) THEN
      v_columns := array_append(v_columns, 'descricao');
      v_values := array_append(v_values, '''Segunda a Sexta''');
    END IF;

    v_sql := format(
      'INSERT INTO public.schedules (%s)
       SELECT %s
       WHERE NOT EXISTS (
         SELECT 1 FROM public.schedules
          WHERE company_id::text = $1::text
            AND lower(btrim(name)) = lower($2)
       )',
      array_to_string(v_columns, ', '),
      array_to_string(v_values, ', ')
    );
    EXECUTE v_sql USING v_company_id, 'Segunda a Sexta', v_shift_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.pwd_bootstrap_company_defaults_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.pwd_bootstrap_company_defaults(NEW.id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pwd_bootstrap_company_defaults ON public.companies;
CREATE TRIGGER trg_pwd_bootstrap_company_defaults
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.pwd_bootstrap_company_defaults_trigger();

COMMIT;

