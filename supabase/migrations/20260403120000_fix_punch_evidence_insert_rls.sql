-- Corrige INSERT em punch_evidence: a política anterior (FOR ALL + USING por company_id)
-- falhava quando company_id do usuário era NULL no subselect ou na checagem WITH CHECK implícita.
-- Permite INSERT apenas quando o time_record pertence ao usuário autenticado (batida própria).

DROP POLICY IF EXISTS "punch_evidence_company" ON public.punch_evidence;

-- Leitura: próprio registro de ponto ou visão da empresa (admin/HR já vê via time_records)
CREATE POLICY "punch_evidence_select" ON public.punch_evidence
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.time_records tr
      WHERE tr.id = time_record_id
        AND tr.user_id = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM public.time_records tr
      INNER JOIN public.users u ON u.id = auth.uid()
      WHERE tr.id = time_record_id
        AND tr.company_id IS NOT NULL
        AND tr.company_id = u.company_id
    )
  );

-- INSERT: só se a marcação é do próprio usuário (evidência alinhada ao RPC rep_register_punch_secure)
CREATE POLICY "punch_evidence_insert_own_record" ON public.punch_evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.time_records tr
      WHERE tr.id = time_record_id
        AND tr.user_id = auth.uid()::text
    )
  );

COMMENT ON POLICY "punch_evidence_insert_own_record" ON public.punch_evidence IS
  'Permite gravar evidência apenas para time_records do próprio usuário (RLS alinhado ao registro de ponto).';
