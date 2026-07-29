-- Limpar throttle recente e promover apenas NSR 16674
UPDATE public.rep_punch_logs
SET last_promotion_attempt_at = NULL
WHERE id = '33877379-6b4d-4070-8a50-eb1dbfa5d532';

SELECT public.rep_promote_pending_rep_punch_logs(
  p_company_id := 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b',
  p_rep_device_id := 'b325be3b-9338-44aa-a0a5-36c2d1fe0a81'::uuid,
  p_only_rep_punch_log_id := '33877379-6b4d-4070-8a50-eb1dbfa5d532'::uuid
) AS promote_result;
