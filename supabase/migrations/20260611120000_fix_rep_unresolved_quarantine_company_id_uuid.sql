-- Corrige trigger de quarentena REP após migração company_id → UUID (20260520170000).
-- O INSERT usava btrim(NEW.company_id::text) em coluna uuid.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rep_unresolved_punches'
      AND column_name = 'company_id'
      AND udt_name = 'text'
  ) THEN
    ALTER TABLE public.rep_unresolved_punches
      ALTER COLUMN company_id TYPE uuid
      USING NULLIF(btrim(company_id), '')::uuid;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rep_punch_logs_sync_unresolved_quarantine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_unresolved boolean;
BEGIN
  v_unresolved :=
    (NEW.resolved_user_id IS NULL OR btrim(COALESCE(NEW.resolved_user_id, '')) = '')
    AND NEW.time_record_id IS NULL
    AND COALESCE(NEW.ignored, false) = false;

  IF v_unresolved THEN
    INSERT INTO public.rep_unresolved_punches (company_id, rep_punch_log_id)
    VALUES (NEW.company_id, NEW.id)
    ON CONFLICT (rep_punch_log_id) DO NOTHING;
  ELSE
    IF NEW.resolved_user_id IS NOT NULL AND btrim(COALESCE(NEW.resolved_user_id, '')) <> '' THEN
      UPDATE public.rep_unresolved_punches
      SET resolved_at = COALESCE(resolved_at, now())
      WHERE rep_punch_log_id = NEW.id;
    END IF;
  END IF;

  IF NEW.time_record_id IS NOT NULL THEN
    UPDATE public.rep_unresolved_punches
    SET resolved_at = COALESCE(resolved_at, now())
    WHERE rep_punch_log_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.rep_punch_logs_sync_unresolved_quarantine() IS
  'Mantém rep_unresolved_punches alinhada a rep_punch_logs; company_id uuid nativo.';

DROP POLICY IF EXISTS rep_unresolved_punches_select_company_admin ON public.rep_unresolved_punches;
CREATE POLICY rep_unresolved_punches_select_company_admin
  ON public.rep_unresolved_punches
  FOR SELECT
  TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid() LIMIT 1)
    AND lower(COALESCE((SELECT role::text FROM public.users WHERE id = auth.uid() LIMIT 1), '')) IN ('admin', 'hr', 'supervisor')
  );
