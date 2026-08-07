-- 1) RLS: admin/HR podem excluir batidas da própria empresa (antes não havia policy FOR DELETE → DELETE falhava).
-- 2) Trigger Portaria 671: tratar lançamentos [STATUS:FOLGA|FALTA|EXTRA] como editáveis/exclusíveis (ex.: criados pelo app com motivo de status).

DROP POLICY IF EXISTS "Admin can delete company time records" ON public.time_records;

CREATE POLICY "Admin can delete company time records" ON public.time_records
  FOR DELETE TO authenticated
  USING (
    company_id = (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)
    AND (SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1) IS NOT NULL
    AND (SELECT lower(u.role::text) FROM public.users u WHERE u.id = auth.uid() LIMIT 1) IN ('admin', 'hr')
  );

COMMENT ON POLICY "Admin can delete company time records" ON public.time_records IS
  'DELETE: admin/HR removem batidas da empresa (imutabilidade REP ainda aplicada no trigger para não-manuais).';

CREATE OR REPLACE FUNCTION public.prevent_update_delete_time_records()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_manual BOOLEAN;
  v_status_lancamento BOOLEAN;
BEGIN
  -- Lançamento de status (folga/falta/extra) pelo app ou RH — deve poder corrigir/excluir.
  v_status_lancamento := COALESCE(OLD.manual_reason, '') ~* '\[STATUS:(FOLGA|FALTA|EXTRA)\]';

  v_manual := COALESCE(OLD.is_manual, false)
    OR COALESCE(OLD.method, '') ILIKE 'admin'
    OR COALESCE(OLD.method, '') ILIKE 'manual'
    OR v_status_lancamento;

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
  'Bloqueia UPDATE/DELETE em batidas REP/app; permite manuais (is_manual, method admin/manual, ou [STATUS:…] em manual_reason).';
