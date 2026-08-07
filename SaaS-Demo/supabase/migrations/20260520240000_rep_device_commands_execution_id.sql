-- Idempotência: uma instância de execução por claim (evita resultado duplicado/fora de ordem).

ALTER TABLE public.rep_device_commands
  ADD COLUMN IF NOT EXISTS execution_id UUID;

CREATE INDEX IF NOT EXISTS idx_rep_device_commands_execution
  ON public.rep_device_commands (id, execution_id)
  WHERE execution_id IS NOT NULL;

COMMENT ON COLUMN public.rep_device_commands.execution_id IS
  'UUID gerado no claim; POST /command-result só aceita se bater com o valor atual.';
