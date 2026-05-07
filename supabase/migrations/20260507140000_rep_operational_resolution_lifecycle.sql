-- Ciclo de vida operacional para reconciliação assistida de batidas REP (sequência inválida).
-- Não altera motor nem promote; apenas metadados em rep_punch_logs para RH/auditoria.

ALTER TABLE public.rep_punch_logs
  ADD COLUMN IF NOT EXISTS operational_resolution_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS operational_resolution_note text,
  ADD COLUMN IF NOT EXISTS operational_resolution_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operational_resolution_at timestamptz;

ALTER TABLE public.rep_punch_logs DROP CONSTRAINT IF EXISTS rep_punch_logs_operational_resolution_status_check;
ALTER TABLE public.rep_punch_logs
  ADD CONSTRAINT rep_punch_logs_operational_resolution_status_check CHECK (
    operational_resolution_status IN ('pending', 'investigating', 'reconciled', 'ignored', 'expired')
  );

COMMENT ON COLUMN public.rep_punch_logs.operational_resolution_status IS
  'pending | investigating | reconciled | ignored | expired — fluxo RH para batidas REP sem promote por sequência ou outra regra operacional.';

CREATE INDEX IF NOT EXISTS idx_rep_punch_logs_operational_resolution
  ON public.rep_punch_logs (company_id, operational_resolution_status)
  WHERE time_record_id IS NULL AND COALESCE(ignored, false) = false;

UPDATE public.rep_punch_logs
SET operational_resolution_status = 'reconciled'
WHERE time_record_id IS NOT NULL
  AND operational_resolution_status = 'pending';

UPDATE public.rep_punch_logs
SET operational_resolution_status = 'ignored'
WHERE COALESCE(ignored, false) = true
  AND operational_resolution_status = 'pending';
