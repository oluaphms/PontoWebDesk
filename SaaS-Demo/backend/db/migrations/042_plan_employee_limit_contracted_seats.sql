-- Alinha enforce_company_plan_employee_limit ao modelo atual (planLimitsCore):
-- - Bloqueia somente INSERT de role=employee com status=active
-- - Conta somente employees/users ativos (não inativos/excluídos)
-- - Limite real = companies.contracted_limits.maxUsers quando numérico
-- - Sem maxUsers contratado (ou enterprise) = ilimitado (não bloqueia)
-- - UPDATE (edição/reativação/inativação) e DELETE nunca passam por este trigger

CREATE OR REPLACE FUNCTION public.enforce_company_plan_employee_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max int;
  v_plan text;
  v_cnt int;
  v_max_raw text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.role, '') <> 'employee' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.status, 'active') <> 'active' THEN
    RETURN NEW;
  END IF;
  IF NEW.company_id IS NULL OR btrim(NEW.company_id::text) = '' THEN
    RETURN NEW;
  END IF;

  SELECT
    lower(btrim(COALESCE(c.plan, 'free'))),
    nullif(btrim(c.contracted_limits->>'maxUsers'), '')
  INTO v_plan, v_max_raw
  FROM public.companies c
  WHERE c.id = NEW.company_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_plan = 'enterprise' THEN
    RETURN NEW;
  END IF;

  -- Sem assento contratado explícito: ilimitado (services/planLimitsCore.getMaxEmployeesForPlan → null).
  IF v_max_raw IS NULL OR v_max_raw !~ '^[0-9]+$' THEN
    RETURN NEW;
  END IF;

  v_max := v_max_raw::int;
  IF v_max < 0 THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::int INTO v_cnt
  FROM public.users u
  WHERE u.company_id = NEW.company_id
    AND u.role = 'employee'
    AND COALESCE(u.status, 'active') = 'active';

  IF v_cnt >= v_max THEN
    RAISE EXCEPTION 'PLAN_LIMIT_REACHED: Limite do plano atingido para colaboradores ativos'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_company_plan_employee_limit() IS
  'Bloqueia somente INSERT de employee ativo quando contracted_limits.maxUsers foi atingido. Enterprise/sem maxUsers = ilimitado. Não age em UPDATE/DELETE.';
