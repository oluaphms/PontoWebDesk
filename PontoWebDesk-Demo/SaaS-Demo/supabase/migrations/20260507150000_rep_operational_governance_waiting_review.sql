-- Extensão do ciclo de vida: waiting_review (limite de retries / revisão RH obrigatória).

ALTER TABLE public.rep_punch_logs DROP CONSTRAINT IF EXISTS rep_punch_logs_operational_resolution_status_check;
ALTER TABLE public.rep_punch_logs
  ADD CONSTRAINT rep_punch_logs_operational_resolution_status_check CHECK (
    operational_resolution_status IN (
      'pending',
      'investigating',
      'waiting_review',
      'reconciled',
      'ignored',
      'expired'
    )
  );

COMMENT ON COLUMN public.rep_punch_logs.operational_resolution_status IS
  'pending | investigating | waiting_review (retries esgotados, exige RH) | reconciled | ignored | expired';

CREATE INDEX IF NOT EXISTS idx_rep_punch_logs_waiting_review
  ON public.rep_punch_logs (company_id, operational_resolution_status)
  WHERE operational_resolution_status = 'waiting_review';
