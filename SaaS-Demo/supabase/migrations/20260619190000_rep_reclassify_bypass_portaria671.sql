-- reclassify_operational_journey_types: bypass Portaria 671 para correção de tipo REP por jornada operacional.

CREATE OR REPLACE FUNCTION public.prevent_update_delete_time_records()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manual BOOLEAN;
  v_status_lancamento BOOLEAN;
  v_seq_rec text;
  v_seq_flag boolean;
  v_journey_reclassify text;
BEGIN
  v_seq_rec := NULLIF(trim(COALESCE(current_setting('ponto.time_record_sequence_reconcile', true), '')), '');
  v_journey_reclassify := NULLIF(trim(COALESCE(current_setting('ponto.operational_journey_reclassify', true), '')), '');

  v_seq_flag := NEW.raw_data @> '{"sequence_adjusted": true}'::jsonb
    OR lower(trim(COALESCE(NEW.raw_data->>'sequence_adjusted', ''))) IN ('true', 't', '1');

  v_status_lancamento := COALESCE(OLD.manual_reason, '') ~* '\[STATUS:(FOLGA|FALTA|EXTRA)\]';

  v_manual := COALESCE(OLD.is_manual, false)
    OR COALESCE(OLD.method, '') ILIKE 'admin'
    OR COALESCE(OLD.method, '') ILIKE 'manual'
    OR v_status_lancamento;

  IF TG_OP = 'UPDATE' THEN
    IF v_manual THEN
      RETURN NEW;
    END IF;
    IF v_seq_rec = '1'
      AND v_seq_flag
      AND public.normalize_time_record_punch_type(OLD.type) = 'entrada'
      AND public.normalize_time_record_punch_type(NEW.type) = 'saida'
    THEN
      RETURN NEW;
    END IF;
    IF v_journey_reclassify = '1'
      AND (COALESCE(OLD.source, '') = 'rep' OR COALESCE(OLD.method, '') ILIKE '%rep%')
      AND OLD.company_id IS NOT DISTINCT FROM NEW.company_id
      AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id
      AND OLD.timestamp IS NOT DISTINCT FROM NEW.timestamp
      AND OLD.nsr IS NOT DISTINCT FROM NEW.nsr
      AND OLD.created_at IS NOT DISTINCT FROM NEW.created_at
      AND OLD.type IS DISTINCT FROM NEW.type
      AND (NEW.raw_data @> '{"journey_type_reclassified": true}'::jsonb
        OR lower(trim(COALESCE(NEW.raw_data->>'journey_type_reclassified', ''))) IN ('true', 't', '1'))
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Alteração de registro de ponto não permitida (Portaria 671). Use time_adjustments para correções.'
      USING ERRCODE = 'check_violation';
  ELSIF TG_OP = 'DELETE' THEN
    IF v_manual THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Exclusão de registro de ponto não permitida (Portaria 671).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.prevent_update_delete_time_records() IS
  'Bloqueia UPDATE/DELETE em batidas REP/app; permite manuais; reconciliação de sequência; reclassificação de jornada operacional (GUC ponto.operational_journey_reclassify).';

CREATE OR REPLACE FUNCTION public.reclassify_operational_journey_types(
  p_company_id uuid,
  p_user_id uuid,
  p_operational_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_pos int := 0;
  v_updated int := 0;
  v_new_type text;
BEGIN
  PERFORM set_config('ponto.operational_journey_reclassify', '1', true);
  PERFORM set_config('ponto.skip_time_record_sequence_check', '1', true);

  FOR r IN
    SELECT tr.id, tr.type AS old_type
    FROM public.time_records tr
    WHERE tr.company_id = p_company_id
      AND tr.user_id = p_user_id
      AND public.time_record_operational_date_sp(p_user_id, p_company_id, COALESCE(tr.timestamp, tr.created_at)) = p_operational_date
      AND (COALESCE(tr.source, '') = 'rep' OR COALESCE(tr.method, '') ILIKE '%rep%')
    ORDER BY COALESCE(tr.timestamp, tr.created_at), tr.id
  LOOP
    v_new_type := public.rep_journey_type_for_position(v_pos);
    IF r.old_type IS DISTINCT FROM v_new_type THEN
      UPDATE public.time_records
      SET
        type = v_new_type,
        raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object(
          'journey_type_reclassified', true,
          'journey_operational_date', p_operational_date::text,
          'journey_type_position', v_pos,
          'journey_type_before', r.old_type
        )
      WHERE id = r.id;
      v_updated := v_updated + 1;
    END IF;
    v_pos := v_pos + 1;
  END LOOP;

  PERFORM set_config('ponto.skip_time_record_sequence_check', '0', true);
  PERFORM set_config('ponto.operational_journey_reclassify', '0', true);

  RETURN jsonb_build_object('updated', v_updated, 'operational_date', p_operational_date);
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('ponto.skip_time_record_sequence_check', '0', true);
    PERFORM set_config('ponto.operational_journey_reclassify', '0', true);
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclassify_operational_journey_types(uuid, uuid, date) TO authenticated, service_role;
