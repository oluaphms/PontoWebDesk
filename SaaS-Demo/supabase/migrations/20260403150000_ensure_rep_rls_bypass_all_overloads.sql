-- Garante SET row_security = off em todas as assinaturas das RPCs REP / evidência.
-- Evita falha "new row violates row-level security policy" se uma migration ALTER anterior
-- não corresponder exatamente à assinatura no banco (overload ou ordem de tipos).

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      n.nspname AS sch,
      p.proname AS fname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'rep_register_punch',
        'rep_register_punch_secure',
        'insert_punch_evidence_for_own_punch'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET row_security = off',
      r.sch,
      r.fname,
      r.args
    );
  END LOOP;
END $$;
