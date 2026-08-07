-- Solicitações (ajuste, férias, mudança de turno) + horário (turno) no cadastro do colaborador

-- 1) Colaborador: horário cadastrado (work_shifts), separado da escala (schedules)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.work_shifts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_shift_id ON public.users(shift_id);

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.work_shifts(id) ON DELETE SET NULL;

-- 2) Tabela de solicitações: criar se não existir, ou alinhar colunas se já existir (schema legado sem company_id, etc.)
CREATE TABLE IF NOT EXISTS public.requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela antiga pode existir sem company_id / type / etc.: adicionar o que faltar
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Preencher company_id a partir de users (linhas antigas)
UPDATE public.requests r
SET company_id = u.company_id
FROM public.users u
WHERE r.user_id = u.id
  AND u.company_id IS NOT NULL
  AND (r.company_id IS NULL OR trim(r.company_id) = '');

-- Evitar NULL em company_id para políticas (ajuste mínimo para linhas órfãs)
UPDATE public.requests
SET company_id = COALESCE(company_id, '')
WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_requests_user_id ON public.requests(user_id);
CREATE INDEX IF NOT EXISTS idx_requests_company_id ON public.requests(company_id);
CREATE INDEX IF NOT EXISTS idx_requests_created_at ON public.requests(created_at DESC);

ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "requests_select_own_or_company" ON public.requests;
CREATE POLICY "requests_select_own_or_company" ON public.requests
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR company_id = public.get_my_company_id()
  );

DROP POLICY IF EXISTS "requests_insert_own_company" ON public.requests;
CREATE POLICY "requests_insert_own_company" ON public.requests
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND company_id = public.get_my_company_id()
  );

DROP POLICY IF EXISTS "requests_update_company" ON public.requests;
CREATE POLICY "requests_update_company" ON public.requests
  FOR UPDATE TO authenticated
  USING (company_id = public.get_my_company_id())
  WITH CHECK (company_id = public.get_my_company_id());

COMMENT ON TABLE public.requests IS 'Solicitações de colaboradores (ajuste de ponto, férias, mudança de turno)';
