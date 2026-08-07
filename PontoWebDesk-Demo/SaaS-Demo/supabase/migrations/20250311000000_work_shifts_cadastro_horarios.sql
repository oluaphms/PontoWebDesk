-- Cadastro de Horários: Número, Descrição e configuração completa (grade semanal, DSR, Extras, Tipo de marcação)
ALTER TABLE public.work_shifts
  ADD COLUMN IF NOT EXISTS number TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

COMMENT ON COLUMN public.work_shifts.number IS 'Número do horário';
COMMENT ON COLUMN public.work_shifts.description IS 'Nome/Descrição do horário';
COMMENT ON COLUMN public.work_shifts.config IS 'Grade semanal (weekly_schedule), DSR (dsr), Extras (extras), Tipo de marcação (tipoMarcacao)';
