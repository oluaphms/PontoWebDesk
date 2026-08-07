-- Lock otimista em operational_tasks (concorrência / idempotência).
ALTER TABLE public.operational_tasks
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.operational_tasks.version IS
  'Incrementado em updates bem-sucedidos; PATCH complete usa eq(version) para evitar processamento duplo.';
