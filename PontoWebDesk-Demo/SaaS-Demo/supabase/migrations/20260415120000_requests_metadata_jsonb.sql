-- Metadados estruturados para solicitações (ex.: data/hora/tipo da batida em ajuste de ponto)

ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.requests.metadata IS
  'JSON opcional. Ajuste de ponto: { "adjustment_date": "YYYY-MM-DD", "adjustment_time": "HH:mm", "punch_type": "ENTRADA"|... }';
