-- Batidas inseridas manualmente (Portaria 1510 / RH) podem ser corrigidas ou excluídas.
-- Batidas do REP e do app permanecem imutáveis (hash/NSR); correção via time_adjustments quando aplicável.

CREATE OR REPLACE FUNCTION public.prevent_update_delete_time_records()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manual BOOLEAN;
BEGIN
  -- Manual: inclusão por admin/RH ou flag explícita (não confundir com batida do relógio/mobile)
  v_manual := COALESCE(OLD.is_manual, false)
    OR COALESCE(OLD.method, '') ILIKE 'admin'
    OR COALESCE(OLD.method, '') ILIKE 'manual';

  IF TG_OP = 'UPDATE' THEN
    IF v_manual THEN
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
  'Bloqueia UPDATE/DELETE em time_records de REP/app; permite correção de batidas manuais (is_manual ou method admin/manual).';
