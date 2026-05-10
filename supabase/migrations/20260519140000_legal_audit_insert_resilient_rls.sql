-- ---------------------------------------------------------------------------
-- Refatoração defensiva da policy de INSERT em operational_legal_audit_trail
-- ---------------------------------------------------------------------------
--
-- Contexto:
--   A policy `legal_audit_insert_own` original exigia
--     actor_id = auth.uid()::text
--     AND company_id = public.get_my_company_id()
--   Em corridas de sessão (auth.refresh + listener `force_monitoring_refresh`
--   disparados em sequência), `get_my_company_id()` pode resolver para NULL e
--   gerar 403 em todos os inserts subsequentes da janela. Isso, combinado com
--   o loop ghost detector × self-heal, gerava centenas de 403/min.
--
-- Desenho da nova policy:
--   - Mantém o vínculo actor_id ↔ auth.uid().
--   - Aceita qualquer company_id que pertença a uma das companhias do usuário
--     (lookup direto em public.users, sem depender exclusivamente de
--     get_my_company_id()).
--   - Aceita também o caminho clássico (`get_my_company_id()`) como fallback
--     idempotente — útil quando a função estiver "quente" no statement.
--
--   Resultado: as condições passam a ser robustas a estados transientes do
--   contexto JWT/SECURITY DEFINER e mantêm o isolamento por tenant.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "legal_audit_insert_own" ON public.operational_legal_audit_trail;

CREATE POLICY "legal_audit_insert_own" ON public.operational_legal_audit_trail
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()::text
    AND (
      company_id = public.get_my_company_id()
      OR company_id IN (
        SELECT u.company_id
        FROM public.users u
        WHERE u.id = auth.uid()
          AND u.company_id IS NOT NULL
      )
    )
  );

-- Garante GRANT idempotente (defesa caso role tenha sido alterada).
GRANT SELECT, INSERT ON public.operational_legal_audit_trail TO authenticated;

COMMENT ON POLICY "legal_audit_insert_own" ON public.operational_legal_audit_trail IS
  'Permite INSERT pelo próprio actor desde que o company_id pertença a uma das '
  'companhias do usuário em public.users. Resiliente a NULL de get_my_company_id() '
  'em contextos transientes pós refresh de auth.';
