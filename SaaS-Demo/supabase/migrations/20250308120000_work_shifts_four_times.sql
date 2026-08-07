-- Horário com 4 registros diários: entrada, saída intervalo, entrada volta intervalo, saída
-- Adiciona colunas de início e fim do intervalo (substituem apenas o uso de break_duration no formulário).
ALTER TABLE public.work_shifts
  ADD COLUMN IF NOT EXISTS break_start_time TIME,
  ADD COLUMN IF NOT EXISTS break_end_time TIME;

COMMENT ON COLUMN public.work_shifts.break_start_time IS 'Horário de saída para intervalo (2º registro do dia)';
COMMENT ON COLUMN public.work_shifts.break_end_time IS 'Horário de retorno do intervalo (3º registro do dia)';
