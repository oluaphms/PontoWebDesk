-- Corrige: column "time_record_id" is of type uuid but expression is of type text
-- Causa: trigger após INSERT em time_records (log_time_record_insert_audit) gravava
-- NEW.id (TEXT) em time_record_change_log.time_record_id (UUID) sem cast.

CREATE OR REPLACE FUNCTION public.log_time_record_insert_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('row_security', 'off', true);
  INSERT INTO public.time_record_change_log (tenant_id, time_record_id, actor_id, action, payload)
  VALUES (
    NEW.company_id,
    (NEW.id::text)::uuid,
    auth.uid(),
    'insert',
    jsonb_build_object(
      'type', NEW.type,
      'method', NEW.method,
      'source', NEW.source,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
END;
$$;
