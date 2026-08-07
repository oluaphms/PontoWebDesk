-- Garante vínculos consistentes de escala/horário entre users e employees.
-- Conservador para produção: não sobrescreve conflitos existentes e valida novos vínculos por tenant.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS schedule_id uuid,
  ADD COLUMN IF NOT EXISTS shift_id uuid;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS schedule_id uuid,
  ADD COLUMN IF NOT EXISTS shift_id uuid;

CREATE INDEX IF NOT EXISTS idx_users_schedule_id ON public.users(schedule_id);
CREATE INDEX IF NOT EXISTS idx_users_shift_id ON public.users(shift_id);
CREATE INDEX IF NOT EXISTS idx_employees_schedule_id ON public.employees(schedule_id);
CREATE INDEX IF NOT EXISTS idx_employees_shift_id ON public.employees(shift_id);
CREATE INDEX IF NOT EXISTS idx_employee_shift_schedule_shift_id ON public.employee_shift_schedule(shift_id);
CREATE INDEX IF NOT EXISTS idx_employee_shift_schedule_work_shift_id ON public.employee_shift_schedule(work_shift_id);

ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_shift_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company isolation work_shifts" ON public.work_shifts;
DROP POLICY IF EXISTS "work_shifts_select" ON public.work_shifts;
DROP POLICY IF EXISTS "work_shifts_modify" ON public.work_shifts;
CREATE POLICY "work_shifts_select" ON public.work_shifts
  FOR SELECT TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
  );
CREATE POLICY "work_shifts_modify" ON public.work_shifts
  FOR ALL TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
  )
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
  );

DROP POLICY IF EXISTS "schedules_select" ON public.schedules;
DROP POLICY IF EXISTS "schedules_modify" ON public.schedules;
CREATE POLICY "schedules_select" ON public.schedules
  FOR SELECT TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
  );
CREATE POLICY "schedules_modify" ON public.schedules
  FOR ALL TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
  )
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
  );

DROP POLICY IF EXISTS "Company isolation schedule" ON public.employee_shift_schedule;
DROP POLICY IF EXISTS "employee_shift_schedule_own" ON public.employee_shift_schedule;
DROP POLICY IF EXISTS "employee_shift_schedule_company" ON public.employee_shift_schedule;
CREATE POLICY "employee_shift_schedule_company" ON public.employee_shift_schedule
  FOR ALL TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
  )
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
      AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.users'::regclass
      AND c.confrelid = 'public.schedules'::regclass
      AND a.attname = 'schedule_id'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_schedule_id_fkey
      FOREIGN KEY (schedule_id) REFERENCES public.schedules(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
      AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.users'::regclass
      AND c.confrelid = 'public.work_shifts'::regclass
      AND a.attname = 'shift_id'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_shift_id_fkey
      FOREIGN KEY (shift_id) REFERENCES public.work_shifts(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
      AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.employees'::regclass
      AND c.confrelid = 'public.schedules'::regclass
      AND a.attname = 'schedule_id'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_schedule_id_fkey
      FOREIGN KEY (schedule_id) REFERENCES public.schedules(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
      AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.employees'::regclass
      AND c.confrelid = 'public.work_shifts'::regclass
      AND a.attname = 'shift_id'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_shift_id_fkey
      FOREIGN KEY (shift_id) REFERENCES public.work_shifts(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

-- Backfill seguro: copia apenas quando o destino está nulo e o vínculo pertence ao mesmo tenant.
UPDATE public.users u
SET schedule_id = e.schedule_id,
    updated_at = now()
FROM public.employees e
JOIN public.schedules s ON s.id = e.schedule_id
WHERE u.id = e.id
  AND u.schedule_id IS NULL
  AND e.schedule_id IS NOT NULL
  AND u.company_id::text IS NOT DISTINCT FROM e.company_id::text
  AND s.company_id::text IS NOT DISTINCT FROM COALESCE(u.company_id::text, e.company_id::text);

UPDATE public.employees e
SET schedule_id = u.schedule_id,
    updated_at = now()
FROM public.users u
JOIN public.schedules s ON s.id = u.schedule_id
WHERE e.id = u.id
  AND e.schedule_id IS NULL
  AND u.schedule_id IS NOT NULL
  AND e.company_id::text IS NOT DISTINCT FROM u.company_id::text
  AND s.company_id::text IS NOT DISTINCT FROM COALESCE(e.company_id::text, u.company_id::text);

UPDATE public.users u
SET shift_id = s.shift_id,
    updated_at = now()
FROM public.schedules s
JOIN public.work_shifts ws ON ws.id = s.shift_id
WHERE u.shift_id IS NULL
  AND u.schedule_id = s.id
  AND s.shift_id IS NOT NULL
  AND s.company_id::text IS NOT DISTINCT FROM u.company_id::text
  AND ws.company_id::text IS NOT DISTINCT FROM u.company_id::text;

UPDATE public.employees e
SET shift_id = s.shift_id,
    updated_at = now()
FROM public.schedules s
JOIN public.work_shifts ws ON ws.id = s.shift_id
WHERE e.shift_id IS NULL
  AND e.schedule_id = s.id
  AND s.shift_id IS NOT NULL
  AND s.company_id::text IS NOT DISTINCT FROM e.company_id::text
  AND ws.company_id::text IS NOT DISTINCT FROM e.company_id::text;

UPDATE public.users u
SET shift_id = e.shift_id,
    updated_at = now()
FROM public.employees e
JOIN public.work_shifts ws ON ws.id = e.shift_id
WHERE u.id = e.id
  AND u.shift_id IS NULL
  AND e.shift_id IS NOT NULL
  AND u.company_id::text IS NOT DISTINCT FROM e.company_id::text
  AND ws.company_id::text IS NOT DISTINCT FROM COALESCE(u.company_id::text, e.company_id::text);

UPDATE public.employees e
SET shift_id = u.shift_id,
    updated_at = now()
FROM public.users u
JOIN public.work_shifts ws ON ws.id = u.shift_id
WHERE e.id = u.id
  AND e.shift_id IS NULL
  AND u.shift_id IS NOT NULL
  AND e.company_id::text IS NOT DISTINCT FROM u.company_id::text
  AND ws.company_id::text IS NOT DISTINCT FROM COALESCE(e.company_id::text, u.company_id::text);

CREATE OR REPLACE FUNCTION public.validate_employee_schedule_shift_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_company_id text;
  v_link_company_id text;
BEGIN
  v_company_id := NULLIF(NEW.company_id::text, '');

  IF NEW.schedule_id IS NOT NULL THEN
    SELECT NULLIF(s.company_id::text, '')
    INTO v_link_company_id
    FROM public.schedules s
    WHERE s.id = NEW.schedule_id
    LIMIT 1;

    IF v_link_company_id IS NULL THEN
      RAISE EXCEPTION 'schedule_id % não pertence a uma empresa válida', NEW.schedule_id
        USING ERRCODE = '23514';
    END IF;

    IF v_company_id IS NOT NULL AND v_link_company_id IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'schedule_id % pertence ao company_id %, não ao company_id %',
        NEW.schedule_id, v_link_company_id, v_company_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.shift_id IS NOT NULL THEN
    SELECT NULLIF(ws.company_id::text, '')
    INTO v_link_company_id
    FROM public.work_shifts ws
    WHERE ws.id = NEW.shift_id
    LIMIT 1;

    IF v_link_company_id IS NULL THEN
      RAISE EXCEPTION 'shift_id % não pertence a uma empresa válida', NEW.shift_id
        USING ERRCODE = '23514';
    END IF;

    IF v_company_id IS NOT NULL AND v_link_company_id IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'shift_id % pertence ao company_id %, não ao company_id %',
        NEW.shift_id, v_link_company_id, v_company_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_users_schedule_shift_links ON public.users;
CREATE TRIGGER trg_validate_users_schedule_shift_links
  BEFORE INSERT OR UPDATE OF company_id, schedule_id, shift_id ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_employee_schedule_shift_links();

DROP TRIGGER IF EXISTS trg_validate_employees_schedule_shift_links ON public.employees;
CREATE TRIGGER trg_validate_employees_schedule_shift_links
  BEFORE INSERT OR UPDATE OF company_id, schedule_id, shift_id ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_employee_schedule_shift_links();

CREATE OR REPLACE FUNCTION public.validate_employee_shift_schedule_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_company_id text;
  v_employee_company_id text;
  v_shift_company_id text;
BEGIN
  v_company_id := NULLIF(NEW.company_id::text, '');

  IF NEW.shift_id IS NOT NULL
     AND NEW.work_shift_id IS NOT NULL
     AND NEW.shift_id IS DISTINCT FROM NEW.work_shift_id THEN
    RAISE EXCEPTION 'shift_id % e work_shift_id % devem apontar para o mesmo horário',
      NEW.shift_id, NEW.work_shift_id
      USING ERRCODE = '23514';
  END IF;

  SELECT NULLIF(u.company_id::text, '')
  INTO v_employee_company_id
  FROM public.users u
  WHERE u.id = NEW.employee_id
  LIMIT 1;

  IF v_company_id IS NOT NULL
     AND v_employee_company_id IS NOT NULL
     AND v_employee_company_id IS DISTINCT FROM v_company_id THEN
    RAISE EXCEPTION 'employee_id % pertence ao company_id %, não ao company_id %',
      NEW.employee_id, v_employee_company_id, v_company_id
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(NEW.shift_id, NEW.work_shift_id) IS NOT NULL THEN
    SELECT NULLIF(ws.company_id::text, '')
    INTO v_shift_company_id
    FROM public.work_shifts ws
    WHERE ws.id = COALESCE(NEW.shift_id, NEW.work_shift_id)
    LIMIT 1;

    IF v_shift_company_id IS NULL THEN
      RAISE EXCEPTION 'horário % não pertence a uma empresa válida',
        COALESCE(NEW.shift_id, NEW.work_shift_id)
        USING ERRCODE = '23514';
    END IF;

    IF v_company_id IS NOT NULL AND v_shift_company_id IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'horário % pertence ao company_id %, não ao company_id %',
        COALESCE(NEW.shift_id, NEW.work_shift_id), v_shift_company_id, v_company_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_employee_shift_schedule_tenant ON public.employee_shift_schedule;
CREATE TRIGGER trg_validate_employee_shift_schedule_tenant
  BEFORE INSERT OR UPDATE OF company_id, employee_id, shift_id, work_shift_id ON public.employee_shift_schedule
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_employee_shift_schedule_tenant();

-- Mantém o espelho users -> employees incluindo shift_id.
CREATE OR REPLACE FUNCTION public.sync_user_to_employees()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF COALESCE(NEW.role, '') IN ('employee', 'admin', 'hr') THEN
    INSERT INTO public.employees (
      id, company_id, department_id, schedule_id, shift_id,
      nome, email, cargo, phone, cpf, status, created_at, updated_at
    )
    VALUES (
      NEW.id,
      NEW.company_id,
      NEW.department_id,
      NEW.schedule_id,
      NEW.shift_id,
      COALESCE(NEW.nome, ''),
      COALESCE(NEW.email, ''),
      COALESCE(NEW.cargo, 'Colaborador'),
      NEW.phone,
      NEW.cpf,
      COALESCE(NEW.status, 'active'),
      COALESCE(NEW.created_at, now()),
      COALESCE(NEW.updated_at, now())
    )
    ON CONFLICT (id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      department_id = EXCLUDED.department_id,
      schedule_id = EXCLUDED.schedule_id,
      shift_id = EXCLUDED.shift_id,
      nome = EXCLUDED.nome,
      email = EXCLUDED.email,
      cargo = EXCLUDED.cargo,
      phone = EXCLUDED.phone,
      cpf = EXCLUDED.cpf,
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at
    WHERE employees.company_id IS DISTINCT FROM EXCLUDED.company_id
       OR employees.department_id IS DISTINCT FROM EXCLUDED.department_id
       OR employees.schedule_id IS DISTINCT FROM EXCLUDED.schedule_id
       OR employees.shift_id IS DISTINCT FROM EXCLUDED.shift_id
       OR employees.nome IS DISTINCT FROM EXCLUDED.nome
       OR employees.email IS DISTINCT FROM EXCLUDED.email
       OR employees.cargo IS DISTINCT FROM EXCLUDED.cargo
       OR employees.phone IS DISTINCT FROM EXCLUDED.phone
       OR employees.cpf IS DISTINCT FROM EXCLUDED.cpf
       OR employees.status IS DISTINCT FROM EXCLUDED.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_user_to_employees ON public.users;
CREATE TRIGGER trigger_sync_user_to_employees
  AFTER INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_to_employees();

-- Propaga mudanças explícitas feitas em employees para users, evitando loop com o trigger acima.
CREATE OR REPLACE FUNCTION public.sync_employee_schedule_shift_to_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_schedule_changed boolean;
  v_shift_changed boolean;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_schedule_changed := NEW.schedule_id IS NOT NULL;
    v_shift_changed := NEW.shift_id IS NOT NULL;
  ELSE
    v_schedule_changed := NEW.schedule_id IS DISTINCT FROM OLD.schedule_id;
    v_shift_changed := NEW.shift_id IS DISTINCT FROM OLD.shift_id;
  END IF;

  IF NOT v_schedule_changed AND NOT v_shift_changed THEN
    RETURN NEW;
  END IF;

  UPDATE public.users u
  SET schedule_id = CASE WHEN v_schedule_changed THEN NEW.schedule_id ELSE u.schedule_id END,
      shift_id = CASE WHEN v_shift_changed THEN NEW.shift_id ELSE u.shift_id END,
      updated_at = now()
  WHERE u.id = NEW.id
    AND u.company_id::text IS NOT DISTINCT FROM NEW.company_id::text
    AND (
      (v_schedule_changed AND u.schedule_id IS DISTINCT FROM NEW.schedule_id)
      OR (v_shift_changed AND u.shift_id IS DISTINCT FROM NEW.shift_id)
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_employee_schedule_shift_to_user ON public.employees;
CREATE TRIGGER trigger_sync_employee_schedule_shift_to_user
  AFTER INSERT OR UPDATE OF schedule_id, shift_id ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_employee_schedule_shift_to_user();
