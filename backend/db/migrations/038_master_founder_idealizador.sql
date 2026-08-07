-- 038 — Idealizador do SaaS (conta Founder protegida)
-- Corrige atribuição: autor do sistema = Paulo Henrique (paulohmorais@hotmail.com).
-- Parceiros Master Owner permanecem sem is_founder.
-- Idempotente.

BEGIN;

DROP TRIGGER IF EXISTS trg_master_users_protect_founder_update ON public.master_users;

UPDATE public.master_users
SET is_founder = false,
    updated_at = COALESCE(updated_at, now())
WHERE is_founder IS TRUE;

UPDATE public.master_users
SET is_founder = true,
    updated_at = now()
WHERE lower(trim(email)) = 'paulohmorais@hotmail.com';

CREATE TRIGGER trg_master_users_protect_founder_update
  BEFORE UPDATE OF is_founder, active, role ON public.master_users
  FOR EACH ROW
  EXECUTE PROCEDURE public.master_users_protect_founder_update();

COMMIT;
