-- Refinos em work_shifts para jornadas inteligentes
-- - shift_type já existe (20250320000000_engine_jornada_escalas.sql)
-- - aqui garantimos colunas de tolerância global e intervalo automático (break_minutes)

ALTER TABLE public.work_shifts
  ADD COLUMN IF NOT EXISTS break_minutes INTEGER DEFAULT 60;

COMMENT ON COLUMN public.work_shifts.break_minutes IS 'Intervalo mínimo/automático em minutos (Portaria 671).';

