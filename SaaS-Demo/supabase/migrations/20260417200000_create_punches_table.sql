-- Criar tabela punches para health check e API de batidas
-- Esta tabela é usada pelo health check e opcionalmente pela API /api/punches

CREATE TABLE IF NOT EXISTS public.punches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL,
  company_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('entrada', 'saída', 'saida', 'pausa', 'E', 'S', 'P')),
  method text NOT NULL DEFAULT 'api',
  created_at timestamptz DEFAULT now(),
  source text NOT NULL DEFAULT 'web' CHECK (source IN ('clock', 'web')),
  
  -- Metadados opcionais
  raw_data jsonb DEFAULT '{}',
  device_id text,
  location jsonb,
  
  -- Controle de envio
  sent_at timestamptz,
  error_count int DEFAULT 0
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_punches_company_id ON public.punches(company_id);
CREATE INDEX IF NOT EXISTS idx_punches_employee_id ON public.punches(employee_id);
CREATE INDEX IF NOT EXISTS idx_punches_created_at ON public.punches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_punches_source ON public.punches(source);

-- Comentários
COMMENT ON TABLE public.punches IS 'Batidas de ponto recebidas via API (web) ou agente local (clock). Usada para health check e fila de envio.';
COMMENT ON COLUMN public.punches.source IS 'clock = agente local / relógio; web = app / API pública';
COMMENT ON COLUMN public.punches.sent_at IS 'Quando a batida foi enviada para time_records (null = pendente)';
COMMENT ON COLUMN public.punches.error_count IS 'Número de tentativas falhas de envio';

-- Política RLS (desativada por padrão - usar service_role para inserção)
ALTER TABLE public.punches ENABLE ROW LEVEL SECURITY;

-- Política: empresas só veem suas próprias batidas
CREATE POLICY "punches_company_isolation" ON public.punches
  FOR ALL USING (company_id = current_setting('app.current_company_id', true));

-- Grant para authenticated
GRANT SELECT, INSERT ON public.punches TO authenticated;
GRANT ALL ON public.punches TO service_role;

-- Inserir registro de teste para health check funcionar imediatamente
INSERT INTO public.punches (employee_id, company_id, type, method, source, sent_at)
VALUES ('00000000000', 'test', 'E', 'health_check', 'web', now())
ON CONFLICT DO NOTHING;
