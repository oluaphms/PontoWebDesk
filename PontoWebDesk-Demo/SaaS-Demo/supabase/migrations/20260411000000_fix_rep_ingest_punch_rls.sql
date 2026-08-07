-- Fix: rep_ingest_punch RLS bypass
-- O rep_ingest_punch() é SECURITY DEFINER mas não tinha SET row_security = off
-- Isso causava "new row violates row-level security policy" ao inserir em time_records
-- Solução: adicionar SET row_security = off como em rep_register_punch

ALTER FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb
) SET row_security = off;

COMMENT ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb
) IS 'REP ingest: rep_punch_logs + time_records. SET row_security=off: bypass RLS para INSERT.';
