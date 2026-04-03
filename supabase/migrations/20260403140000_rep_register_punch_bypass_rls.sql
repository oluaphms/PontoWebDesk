-- RPCs de registro de ponto: RLS avalia o usuário da SESSÃO (JWT), não o dono da função.
-- Tabelas time_records e point_receipts só tinham políticas de SELECT → INSERT dentro do RPC
-- falhava com "new row violates row-level security policy".
-- Solução: desativar RLS durante a execução da função (validação auth.uid() já existe no corpo).
-- Ref: https://www.postgresql.org/docs/current/sql-createfunction.html (SET configuration_parameter)

ALTER FUNCTION public.rep_register_punch(
  text, text, text, text, text, jsonb, text, text
) SET row_security = off;

ALTER FUNCTION public.rep_register_punch_secure(
  text, text, text, text, text, jsonb, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb
) SET row_security = off;

-- Evidência: mesma lógica se a função existir (migration 20260403120000)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'insert_punch_evidence_for_own_punch'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.insert_punch_evidence_for_own_punch(text, text, numeric, numeric, text, numeric) SET row_security = off';
  END IF;
END $$;

COMMENT ON FUNCTION public.rep_register_punch_secure(
  text, text, text, text, text, jsonb, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb
) IS 'REP-P + antifraude. SET row_security=off: INSERT em time_records/point_receipts exige bypass RLS (políticas só SELECT).';
