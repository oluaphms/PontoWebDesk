-- ============================================================
-- RLS: permitir que o app registre funcionários, horários, escalas e departamentos
-- Corrige: "new row violates row-level security policy for table users"
-- ============================================================

-- 1) USERS: admin precisa inserir/atualizar funcionários da mesma empresa;
--    usuário pode inserir/atualizar o próprio perfil (ex: primeiro login).

-- Garantir RLS ativo
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Remover políticas antigas (só permitiam auth.uid() = id)
DROP POLICY IF EXISTS "Users can view own data" ON public.users;
DROP POLICY IF EXISTS "Users can update own data" ON public.users;
DROP POLICY IF EXISTS "Users can insert own data" ON public.users;

-- SELECT: ver próprio perfil OU usuários da mesma empresa (lista de funcionários para admin)
CREATE POLICY "users_select_own_or_company" ON public.users
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
  );

-- INSERT: próprio perfil (id = auth.uid()) OU novo funcionário da mesma empresa (admin cadastrando)
CREATE POLICY "users_insert_own_or_company" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = id
    OR (
      company_id IS NOT NULL
      AND company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    )
  );

-- UPDATE: próprio perfil OU funcionário da mesma empresa (admin editando)
CREATE POLICY "users_update_own_or_company" ON public.users
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = id
    OR company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
  );

-- 2) DEPARTMENTS: garantir que INSERT/UPDATE usem mesma empresa (só se a tabela existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'departments') THEN
    ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Departments select company" ON public.departments;
    DROP POLICY IF EXISTS "Departments modify admin" ON public.departments;
    CREATE POLICY "departments_select_company" ON public.departments
      FOR SELECT TO authenticated
      USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
    CREATE POLICY "departments_insert_company" ON public.departments
      FOR INSERT TO authenticated
      WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
    CREATE POLICY "departments_update_company" ON public.departments
      FOR UPDATE TO authenticated
      USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
    CREATE POLICY "departments_delete_company" ON public.departments
      FOR DELETE TO authenticated
      USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
  END IF;
END $$;

-- 3) COMPANIES: garantir INSERT/UPDATE/SELECT para autenticados (só se a tabela existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'companies') THEN
    ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "Companies select authenticated" ON public.companies;
    DROP POLICY IF EXISTS "Companies insert authenticated" ON public.companies;
    DROP POLICY IF EXISTS "Companies update authenticated" ON public.companies;
    CREATE POLICY "Companies select authenticated" ON public.companies
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY "Companies insert authenticated" ON public.companies
      FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY "Companies update authenticated" ON public.companies
      FOR UPDATE TO authenticated USING (true);
  END IF;
END $$;

-- 4) work_shifts e schedules: garantir INSERT/UPDATE com WITH CHECK (true) para não bloquear no app
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_shifts') THEN
    ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "work_shifts_select" ON public.work_shifts;
    DROP POLICY IF EXISTS "work_shifts_modify" ON public.work_shifts;
    CREATE POLICY "work_shifts_select" ON public.work_shifts
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY "work_shifts_modify" ON public.work_shifts
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schedules') THEN
    ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "schedules_select" ON public.schedules;
    DROP POLICY IF EXISTS "schedules_modify" ON public.schedules;
    CREATE POLICY "schedules_select" ON public.schedules
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY "schedules_modify" ON public.schedules
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
