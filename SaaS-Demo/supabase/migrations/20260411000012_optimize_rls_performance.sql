-- ============================================================
-- Otimiza performance desabilitando RLS em tabelas que não
-- precisam de proteção de dados sensíveis
--
-- Problema: RLS está causando timeout e lentidão
-- Solução: Desabilitar RLS em tabelas públicas
-- ============================================================

-- 1) Desabilitar RLS em tabelas que contêm dados públicos/não-sensíveis
-- Essas tabelas são lidas por admin/HR e não contêm dados pessoais sensíveis

-- Departments (departamentos da empresa)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'departments') THEN
    ALTER TABLE public.departments DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Companies (empresas)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'companies') THEN
    ALTER TABLE public.companies DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Schedules (escalas)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schedules') THEN
    ALTER TABLE public.schedules DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Employee_shift_schedule (escala de turnos dos funcionários)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employee_shift_schedule') THEN
    ALTER TABLE public.employee_shift_schedule DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Holidays (feriados)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'holidays') THEN
    ALTER TABLE public.holidays DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Job_titles (cargos)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'job_titles') THEN
    ALTER TABLE public.job_titles DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Marital_statuses (estados civis)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'marital_statuses') THEN
    ALTER TABLE public.marital_statuses DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Dismissal_reasons (motivos de demissão)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'dismissal_reasons') THEN
    ALTER TABLE public.dismissal_reasons DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Cities (cidades)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cities') THEN
    ALTER TABLE public.cities DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- States (estados)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'states') THEN
    ALTER TABLE public.states DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Requests (solicitações)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'requests') THEN
    ALTER TABLE public.requests DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Logging (logs)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'logging') THEN
    ALTER TABLE public.logging DISABLE ROW LEVEL SECURITY;
  END IF;
END $$;
