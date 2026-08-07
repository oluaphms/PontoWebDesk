-- P0 — Preserva a trilha legal de ponto.
-- Corrige public.cleanup_old_punches() sem editar a migration histórica.
-- A rotina continua removendo apenas staging REP expirado; time_records nunca é apagada.

BEGIN;

CREATE OR REPLACE FUNCTION public.cleanup_old_punches()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_limit integer := 2000;
BEGIN
  DELETE FROM public.rep_punch_logs
  WHERE id IN (
    SELECT id
    FROM public.rep_punch_logs
    WHERE created_at < NOW() - INTERVAL '7 days'
    ORDER BY created_at ASC
    LIMIT v_limit
  );
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_punches() IS
  'Remove somente staging rep_punch_logs >7d em lotes. Preserva permanentemente public.time_records.';

REVOKE ALL ON FUNCTION public.cleanup_old_punches() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.cleanup_old_punches() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.cleanup_old_punches() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.cleanup_old_punches() TO service_role;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
