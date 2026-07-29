-- P0 — Restringe execução direta de RPCs SECURITY DEFINER críticas.
-- Não altera regras internas nem dados; reduz apenas a superfície de privilégios.
-- Fluxos LGPD existentes usam service_role no backend.
-- RPCs operacionais permanecem disponíveis para authenticated e service_role.

BEGIN;

DO $$
DECLARE
  fn record;
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_authenticated boolean := EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'authenticated'
  );
  has_service_role boolean := EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'service_role'
  );
BEGIN
  FOR fn IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'anonymize_user',
        'lgpd_export_user_data',
        'insert_time_record_for_user',
        'insert_time_record_for_user_v2',
        'rep_ingest_punch',
        'rep_promote_pending_rep_punch_logs',
        'rep_ignore_punch_logs'
      )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC',
      fn.schema_name,
      fn.function_name,
      fn.identity_arguments
    );

    IF has_anon THEN
      EXECUTE format(
        'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM anon',
        fn.schema_name,
        fn.function_name,
        fn.identity_arguments
      );
    END IF;

    IF has_authenticated THEN
      IF fn.function_name IN ('anonymize_user', 'lgpd_export_user_data') THEN
        EXECUTE format(
          'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM authenticated',
          fn.schema_name,
          fn.function_name,
          fn.identity_arguments
        );
      ELSE
        EXECUTE format(
          'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated',
          fn.schema_name,
          fn.function_name,
          fn.identity_arguments
        );
      END IF;
    END IF;

    IF has_service_role THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO service_role',
        fn.schema_name,
        fn.function_name,
        fn.identity_arguments
      );
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
