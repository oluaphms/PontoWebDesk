-- Sincronização agente local → nuvem: identidade (rep_id + nsr) e metadados de sync
-- Nota: INSERT idempotente via rep_ingest_punch; UPDATE em time_records continua bloqueado (Portaria 671).

ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS rep_id TEXT;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS synced BOOLEAN DEFAULT TRUE;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;

COMMENT ON COLUMN public.time_records.rep_id IS 'Identificador do relógio (ex.: devices.id) para deduplicação com NSR no sync local';
COMMENT ON COLUMN public.time_records.synced IS 'Quando inserido na nuvem a partir do agente local, pode ser FALSE até o push';
COMMENT ON COLUMN public.time_records.synced_at IS 'Quando o registro foi confirmado como sincronizado na nuvem';

CREATE UNIQUE INDEX IF NOT EXISTS idx_time_records_rep_id_nsr_unique
  ON public.time_records (rep_id, nsr)
  WHERE rep_id IS NOT NULL AND nsr IS NOT NULL;
