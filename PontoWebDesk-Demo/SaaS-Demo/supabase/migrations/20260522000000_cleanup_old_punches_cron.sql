-- Retenção automática: rep_punch_logs (7d) + time_records (30d) — job diário 03:00 UTC
-- Complementa cleanup_old_logs_batch (lotes a cada 10 min).

CREATE OR REPLACE FUNCTION public.cleanup_old_punches()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  DELETE FROM public.time_records
  WHERE id IN (
    SELECT id
    FROM public.time_records
    WHERE created_at < NOW() - INTERVAL '30 days'
    ORDER BY created_at ASC
    LIMIT v_limit
  );
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_punches() IS
  'Remove rep_punch_logs >7d e time_records >30d em lotes (cron diário).';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  ELSE
    RAISE NOTICE 'pg_cron indisponível — cleanup_old_punches via cron do SO';
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    NULL;
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron skip: %', SQLERRM;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-punches-daily') THEN
      PERFORM cron.unschedule('cleanup-punches-daily');
    END IF;
    PERFORM cron.schedule(
      'cleanup-punches-daily',
      '0 3 * * *',
      $cron$SELECT public.cleanup_old_punches();$cron$
    );
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
  WHEN OTHERS THEN
    RAISE NOTICE 'cleanup-punches-daily cron não agendado: %', SQLERRM;
END;
$$;

NOTIFY pgrst, 'reload schema';
