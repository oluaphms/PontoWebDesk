-- Tabela de departamentos (setores) por empresa.
-- Permite cadastro de departamentos para vincular aos funcionários.
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  manager_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_departments_company_id ON public.departments(company_id);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_select_company" ON public.departments;
DROP POLICY IF EXISTS "departments_insert_company" ON public.departments;
DROP POLICY IF EXISTS "departments_update_company" ON public.departments;
DROP POLICY IF EXISTS "departments_delete_company" ON public.departments;
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

-- Garantir que users tenha department_id (UUID ou TEXT) para referência
-- Se a coluna existir como TEXT, mantemos; novos projetos podem usar UUID.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'department_id') THEN
    ALTER TABLE public.users ADD COLUMN department_id TEXT;
  END IF;
END $$;
