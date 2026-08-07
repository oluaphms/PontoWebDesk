-- Corrige rep_ignore_punch_logs após company_id UUID em rep_punch_logs (operator uuid = text).

CREATE OR REPLACE FUNCTION public.rep_ignore_punch_logs(
  p_company_id TEXT,
  p_nsr_list BIGINT[],
  p_ignored_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_updated INTEGER := 0;
  v_cid text;
BEGIN
  v_cid := btrim(COALESCE(p_company_id, ''));
  IF v_cid = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'company_id_required', 'ignored_count', 0);
  END IF;

  UPDATE public.rep_punch_logs
  SET
    ignored = TRUE,
    ignored_at = NOW(),
    ignored_by = p_ignored_by
  WHERE btrim(company_id::text) = v_cid
    AND nsr = ANY(p_nsr_list)
    AND COALESCE(ignored, FALSE) = FALSE;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', TRUE,
    'ignored_count', v_updated
  );
END;
$$;

COMMENT ON FUNCTION public.rep_ignore_punch_logs(TEXT, BIGINT[], UUID) IS
  'Marca batidas na fila como ignoradas; company_id comparado via ::text (UUID-safe).';

GRANT EXECUTE ON FUNCTION public.rep_ignore_punch_logs(TEXT, BIGINT[], UUID) TO authenticated, service_role;
