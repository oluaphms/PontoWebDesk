-- Corrige INSERT em punch_evidence (RLS) e torna a migration idempotente.
-- Problemas anteriores: política FOR ALL sem WITH CHECK adequado; erro 42710 ao reexecutar.
-- Inclui RPC SECURITY DEFINER para insert confiável (mesmo se políticas falharem em edge cases).

-- 1) Remover políticas antigas / de tentativas anteriores (pode rodar o script mais de uma vez)
DROP POLICY IF EXISTS "punch_evidence_company" ON public.punch_evidence;
DROP POLICY IF EXISTS "punch_evidence_select" ON public.punch_evidence;
DROP POLICY IF EXISTS "punch_evidence_insert_own_record" ON public.punch_evidence;

-- 2) SELECT: própria evidência ou mesma empresa (admin)
CREATE POLICY "punch_evidence_select" ON public.punch_evidence
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.time_records tr
      WHERE tr.id::text = time_record_id::text
        AND tr.user_id IS NOT DISTINCT FROM auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM public.time_records tr
      INNER JOIN public.users u ON u.id::text = auth.uid()::text
      WHERE tr.id::text = time_record_id::text
        AND tr.company_id IS NOT NULL
        AND tr.company_id IS NOT DISTINCT FROM u.company_id
    )
  );

-- 3) INSERT via política (cliente direto)
CREATE POLICY "punch_evidence_insert_own_record" ON public.punch_evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.time_records tr
      WHERE tr.id::text = time_record_id::text
        AND tr.user_id IS NOT DISTINCT FROM auth.uid()::text
    )
  );

COMMENT ON POLICY "punch_evidence_insert_own_record" ON public.punch_evidence IS
  'INSERT de evidência só se time_records.user_id = auth.uid() (comparação texto).';

-- 4) RPC: insert pela própria sessão, sem depender só do WITH CHECK (útil no mobile / PostgREST)
CREATE OR REPLACE FUNCTION public.insert_punch_evidence_for_own_punch(
  p_time_record_id text,
  p_photo_url text DEFAULT NULL,
  p_location_lat numeric DEFAULT NULL,
  p_location_lng numeric DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_fraud_score numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou expirada. Faça login novamente.'
      USING ERRCODE = '42501';
  END IF;

  v_id := trim(both from p_time_record_id);
  IF v_id IS NULL OR v_id = '' THEN
    RAISE EXCEPTION 'time_record_id obrigatório';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.time_records tr
    WHERE tr.id::text = v_id
      AND tr.user_id IS NOT DISTINCT FROM auth.uid()::text
  ) THEN
    RAISE EXCEPTION 'Marcação não encontrada ou não pertence ao usuário.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.punch_evidence (
    time_record_id,
    photo_url,
    location_lat,
    location_lng,
    device_id,
    fraud_score
  ) VALUES (
    v_id,
    p_photo_url,
    p_location_lat,
    p_location_lng,
    p_device_id,
    p_fraud_score
  );
END;
$$;

COMMENT ON FUNCTION public.insert_punch_evidence_for_own_punch IS
  'Insere punch_evidence para batida do próprio usuário (bypass RLS seguro via SECURITY DEFINER + checagem).';

GRANT EXECUTE ON FUNCTION public.insert_punch_evidence_for_own_punch(text, text, numeric, numeric, text, numeric) TO authenticated;
