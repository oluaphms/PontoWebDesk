-- Fila de tarefas operacionais (auto-remediação / acompanhamento humano).
CREATE TABLE IF NOT EXISTS public.operational_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id text NOT NULL,
  employee_id uuid REFERENCES public.users (id) ON DELETE CASCADE,

  task_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'failed')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),

  title text,
  description text,

  related_alert_id uuid REFERENCES public.operational_alerts (id) ON DELETE SET NULL,
  related_date date,

  assigned_to uuid REFERENCES public.users (id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

COMMENT ON TABLE public.operational_tasks IS
  'Tarefas derivadas de alertas operacionais; evita duplicar tarefa aberta no mesmo dia/tipo (índice parcial).';

CREATE INDEX IF NOT EXISTS idx_tasks_company ON public.operational_tasks (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.operational_tasks (status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_tasks_open_dedupe
  ON public.operational_tasks (company_id, employee_id, related_date, task_type)
  WHERE status IS DISTINCT FROM 'done';

ALTER TABLE public.operational_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operational_tasks_select" ON public.operational_tasks;
CREATE POLICY "operational_tasks_select"
  ON public.operational_tasks FOR SELECT TO authenticated
  USING (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "operational_tasks_insert" ON public.operational_tasks;
CREATE POLICY "operational_tasks_insert"
  ON public.operational_tasks FOR INSERT TO authenticated
  WITH CHECK (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "operational_tasks_update" ON public.operational_tasks;
CREATE POLICY "operational_tasks_update"
  ON public.operational_tasks FOR UPDATE TO authenticated
  USING (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  )
  WITH CHECK (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS "operational_tasks_delete" ON public.operational_tasks;
CREATE POLICY "operational_tasks_delete"
  ON public.operational_tasks FOR DELETE TO authenticated
  USING (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.operational_tasks TO authenticated;
GRANT ALL ON public.operational_tasks TO service_role;
