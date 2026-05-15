-- FASE 3: auditoria de vínculo manual em batidas não identificadas.

ALTER TABLE public.rep_unresolved_punches
  ADD COLUMN IF NOT EXISTS linked_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.rep_unresolved_punches
  ADD COLUMN IF NOT EXISTS linked_at timestamptz;

ALTER TABLE public.rep_unresolved_punches
  ADD COLUMN IF NOT EXISTS link_strategy text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rep_unresolved_punches_link_strategy_check'
      AND conrelid = 'public.rep_unresolved_punches'::regclass
  ) THEN
    ALTER TABLE public.rep_unresolved_punches
      ADD CONSTRAINT rep_unresolved_punches_link_strategy_check
      CHECK (link_strategy IN ('manual_admin_link', 'auto_match', 'fallback'));
  END IF;
END $$;

COMMENT ON COLUMN public.rep_unresolved_punches.linked_by_user_id IS
  'Usuário admin/RH que realizou o vínculo manual.';
COMMENT ON COLUMN public.rep_unresolved_punches.linked_at IS
  'Momento do vínculo manual.';
COMMENT ON COLUMN public.rep_unresolved_punches.link_strategy IS
  'Estratégia de vínculo usada (manual_admin_link | auto_match | fallback).';

CREATE OR REPLACE FUNCTION public.rep_admin_link_unresolved_punch(
  p_rep_punch_log_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_role text;
  v_admin_company text;
  v_actor uuid;
  r public.rep_punch_logs%ROWTYPE;
  v_promo jsonb;
BEGIN
  v_actor := auth.uid();
  SELECT lower(COALESCE(u.role::text, '')), btrim(u.company_id::text)
  INTO v_role, v_admin_company
  FROM public.users u
  WHERE u.id = v_actor
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('admin', 'hr', 'supervisor') THEN
    RETURN jsonb_build_object('success', false, 'error', 'permissão negada');
  END IF;

  SELECT * INTO r FROM public.rep_punch_logs WHERE id = p_rep_punch_log_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'registo não encontrado');
  END IF;

  IF btrim(r.company_id::text) IS DISTINCT FROM v_admin_company THEN
    RETURN jsonb_build_object('success', false, 'error', 'empresa incorreta');
  END IF;

  IF r.time_record_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'já promovido');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_user_id AND btrim(u.company_id::text) = v_admin_company
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'colaborador inválido');
  END IF;

  UPDATE public.rep_punch_logs
  SET
    resolved_user_id = p_user_id::text,
    raw_data = (
      COALESCE(raw_data, '{}'::jsonb)
      - 'unresolved'
      - 'unresolved_reason'
    ) || jsonb_build_object(
      'canonical_user_id', p_user_id::text,
      'manual_admin_link', true,
      'status', 'identified',
      'match_strategy', 'manual_admin_link',
      'match_confidence', 'medium'
    )
  WHERE id = p_rep_punch_log_id;

  UPDATE public.rep_unresolved_punches
  SET
    manually_linked_user_id = p_user_id,
    linked_by_user_id = v_actor,
    linked_at = now(),
    link_strategy = 'manual_admin_link',
    resolved_at = COALESCE(resolved_at, now())
  WHERE rep_punch_log_id = p_rep_punch_log_id;

  v_promo := public.rep_promote_pending_rep_punch_logs(
    btrim(r.company_id::text),
    r.rep_device_id,
    NULL,
    NULL,
    p_user_id,
    p_rep_punch_log_id
  );

  RETURN COALESCE(v_promo, '{}'::jsonb) || jsonb_build_object('manual_linked', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rep_admin_link_unresolved_punch(uuid, uuid) TO authenticated, service_role;
