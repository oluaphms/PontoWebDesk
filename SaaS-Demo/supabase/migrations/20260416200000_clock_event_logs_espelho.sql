-- Espelho de ponto: metadados após promover clock_event_logs → time_records (via rep_ingest_punch no agente)

ALTER TABLE public.clock_event_logs
  ADD COLUMN IF NOT EXISTS time_record_id text,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS promote_error text;

COMMENT ON COLUMN public.clock_event_logs.time_record_id IS 'ID em public.time_records quando promovido com sucesso.';
COMMENT ON COLUMN public.clock_event_logs.promoted_at IS 'Quando a tentativa de promoção ao espelho foi concluída (sucesso ou erro terminal).';
COMMENT ON COLUMN public.clock_event_logs.promote_error IS 'Mensagem se não houve time_record (ex.: user_not_found, RPC).';

CREATE INDEX IF NOT EXISTS idx_clock_event_logs_pending_espelho
  ON public.clock_event_logs(company_id, device_id, occurred_at)
  WHERE promoted_at IS NULL;
