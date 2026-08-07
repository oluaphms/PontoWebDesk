-- 036 — Conta Founder imutável (Master)
-- Proteção permanente por flag is_founder (não por e-mail/nome).
-- Idempotente. Não altera auth operacional nem roles existentes.

BEGIN;

ALTER TABLE public.master_users
  ADD COLUMN IF NOT EXISTS is_founder boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_master_users_is_founder
  ON public.master_users (is_founder)
  WHERE is_founder = true;

-- Impede DELETE de Founder.
CREATE OR REPLACE FUNCTION public.master_users_forbid_founder_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_founder IS TRUE THEN
    RAISE EXCEPTION 'FOUNDER_DELETE_DENIED: conta Founder não pode ser excluída'
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_master_users_forbid_founder_delete ON public.master_users;
CREATE TRIGGER trg_master_users_forbid_founder_delete
  BEFORE DELETE ON public.master_users
  FOR EACH ROW
  EXECUTE PROCEDURE public.master_users_forbid_founder_delete();

-- Impede desativar, rebaixar (role) ou remover flag Founder.
CREATE OR REPLACE FUNCTION public.master_users_protect_founder_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_founder IS TRUE THEN
    IF NEW.is_founder IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'FOUNDER_ROLE_CHANGE_DENIED: flag is_founder é imutável'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.active IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'FOUNDER_DISABLE_DENIED: conta Founder não pode ser desativada/bloqueada'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'FOUNDER_ROLE_CHANGE_DENIED: perfil da conta Founder é imutável'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_master_users_protect_founder_update ON public.master_users;
CREATE TRIGGER trg_master_users_protect_founder_update
  BEFORE UPDATE OF is_founder, active, role ON public.master_users
  FOR EACH ROW
  EXECUTE PROCEDURE public.master_users_protect_founder_update();

COMMENT ON COLUMN public.master_users.is_founder IS
  'Atributo imutável do Fundador do SaaS. Proteção permanente — não usar e-mail/nome.';

COMMIT;
