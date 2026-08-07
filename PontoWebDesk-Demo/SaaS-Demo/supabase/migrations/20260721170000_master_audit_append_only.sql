-- Espelho Supabase da migration backend 029 — Auditoria Master append-only.
-- Idempotente. Não altera schema de colunas.

BEGIN;

CREATE OR REPLACE FUNCTION public.master_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'master_audit is append-only (Fase 5.1): % not allowed', TG_OP
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_master_audit_append_only_row
  ON public.master_audit;
CREATE TRIGGER trg_master_audit_append_only_row
  BEFORE UPDATE OR DELETE ON public.master_audit
  FOR EACH ROW
  EXECUTE PROCEDURE public.master_audit_append_only();

DROP TRIGGER IF EXISTS trg_master_audit_append_only_truncate
  ON public.master_audit;
CREATE TRIGGER trg_master_audit_append_only_truncate
  BEFORE TRUNCATE ON public.master_audit
  FOR EACH STATEMENT
  EXECUTE PROCEDURE public.master_audit_append_only();

COMMENT ON FUNCTION public.master_audit_append_only() IS
  'Fase 5.1 — rejeita UPDATE/DELETE/TRUNCATE em master_audit';
COMMENT ON TABLE public.master_audit IS
  'Painel Master — auditoria HTTP (append-only: somente INSERT)';

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.master_audit FROM PUBLIC;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT rolname
    FROM pg_roles
    WHERE rolcanlogin = true
      AND rolsuper = false
      AND rolname NOT LIKE 'pg_%'
  LOOP
    BEGIN
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.master_audit FROM %I',
        r.rolname
      );
    EXCEPTION
      WHEN undefined_object THEN
        NULL;
      WHEN insufficient_privilege THEN
        NULL;
    END;
  END LOOP;
END $$;

-- SELECT/INSERT existentes do role da aplicação são preservados.
-- Autorização de leitura Master continua na API (audit:read).

COMMIT;
