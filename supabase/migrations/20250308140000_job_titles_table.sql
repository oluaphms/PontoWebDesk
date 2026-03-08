-- Tabela de cargos por empresa.
-- Permite cadastro de cargos para vincular aos funcionários.
CREATE TABLE IF NOT EXISTS public.job_titles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_titles_company_id ON public.job_titles(company_id);

ALTER TABLE public.job_titles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_titles_select_company" ON public.job_titles;
DROP POLICY IF EXISTS "job_titles_insert_company" ON public.job_titles;
DROP POLICY IF EXISTS "job_titles_update_company" ON public.job_titles;
DROP POLICY IF EXISTS "job_titles_delete_company" ON public.job_titles;

CREATE POLICY "job_titles_select_company" ON public.job_titles
  FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "job_titles_insert_company" ON public.job_titles
  FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "job_titles_update_company" ON public.job_titles
  FOR UPDATE TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "job_titles_delete_company" ON public.job_titles
  FOR DELETE TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
