-- Tabela de funcionários (espelho dos users com role = 'employee').
-- Mantida em sincronia com public.users para relatórios e listagens por funcionário.

-- Garantir colunas em users necessárias para o sync (compatibilidade com bancos antigos)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS schedule_id UUID;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS cpf TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

CREATE TABLE IF NOT EXISTS public.employees (
  id UUID PRIMARY KEY,
  company_id TEXT,
  department_id TEXT,
  schedule_id UUID,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  cargo TEXT DEFAULT 'Colaborador',
  phone TEXT,
  cpf TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email ON public.employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_company_id ON public.employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_department_id ON public.employees(department_id);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employees_select_company" ON public.employees;
DROP POLICY IF EXISTS "employees_insert_company" ON public.employees;
DROP POLICY IF EXISTS "employees_update_company" ON public.employees;
DROP POLICY IF EXISTS "employees_delete_company" ON public.employees;

CREATE POLICY "employees_select_company" ON public.employees
  FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()) OR id = auth.uid());

CREATE POLICY "employees_insert_company" ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "employees_update_company" ON public.employees
  FOR UPDATE TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "employees_delete_company" ON public.employees
  FOR DELETE TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Função que sincroniza um registro de users (role=employee) para employees
CREATE OR REPLACE FUNCTION public.sync_user_to_employees()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IN ('employee', 'admin', 'hr') THEN
    INSERT INTO public.employees (id, company_id, department_id, schedule_id, nome, email, cargo, phone, cpf, status, created_at, updated_at)
    VALUES (
      NEW.id,
      NEW.company_id,
      NEW.department_id,
      NEW.schedule_id,
      COALESCE(NEW.nome, ''),
      COALESCE(NEW.email, ''),
      COALESCE(NEW.cargo, 'Colaborador'),
      NEW.phone,
      NEW.cpf,
      COALESCE(NEW.status, 'active'),
      COALESCE(NEW.created_at, NOW()),
      COALESCE(NEW.updated_at, NOW())
    )
    ON CONFLICT (id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      department_id = EXCLUDED.department_id,
      schedule_id = EXCLUDED.schedule_id,
      nome = EXCLUDED.nome,
      email = EXCLUDED.email,
      cargo = EXCLUDED.cargo,
      phone = EXCLUDED.phone,
      cpf = EXCLUDED.cpf,
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: ao inserir ou atualizar em users, sincronizar para employees
DROP TRIGGER IF EXISTS trigger_sync_user_to_employees ON public.users;
CREATE TRIGGER trigger_sync_user_to_employees
  AFTER INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_to_employees();

-- Ao excluir usuário, remover de employees
CREATE OR REPLACE FUNCTION public.sync_employees_on_user_delete()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.employees WHERE id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_employees_on_user_delete ON public.users;
CREATE TRIGGER trigger_employees_on_user_delete
  AFTER DELETE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_employees_on_user_delete();

-- Preencher employees com os usuários existentes (role employee, admin, hr)
INSERT INTO public.employees (id, company_id, department_id, schedule_id, nome, email, cargo, phone, cpf, status, created_at, updated_at)
SELECT id, company_id, department_id, schedule_id, COALESCE(nome,''), COALESCE(email,''), COALESCE(cargo,'Colaborador'), phone, cpf, COALESCE(status,'active'), created_at, updated_at
FROM public.users
WHERE role IN ('employee', 'admin', 'hr')
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  department_id = EXCLUDED.department_id,
  schedule_id = EXCLUDED.schedule_id,
  nome = EXCLUDED.nome,
  email = EXCLUDED.email,
  cargo = EXCLUDED.cargo,
  phone = EXCLUDED.phone,
  cpf = EXCLUDED.cpf,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at;
