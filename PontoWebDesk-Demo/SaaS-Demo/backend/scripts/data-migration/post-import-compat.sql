-- Ajustes após importar dados do Supabase (schema já existe via db:migrate:full).
-- Idempotente — pode reexecutar.

BEGIN;
SET search_path = public, extensions;

-- ─── Colaboradores: colunas usadas pela API REST ─────────────────────────────
UPDATE public.employees
SET telefone = phone
WHERE telefone IS NULL AND phone IS NOT NULL;

UPDATE public.employees e
SET data_admissao = u.admissao
FROM public.users u
WHERE e.id = u.id
  AND e.data_admissao IS NULL
  AND u.admissao IS NOT NULL;

UPDATE public.employees e
SET departamento = d.name
FROM public.departments d
WHERE e.departamento IS NULL
  AND e.department_id IS NOT NULL
  AND d.id::text = e.department_id::text;

UPDATE public.employees
SET salario = salario_base
WHERE salario IS NULL AND salario_base IS NOT NULL;

UPDATE public.employees
SET cargo = COALESCE(NULLIF(trim(cargo), ''), 'Colaborador')
WHERE cargo IS NULL OR trim(cargo) = '';

-- ─── Login API (JWT): password_hash em public.users ─────────────────────────
-- Utilizadores importados do Supabase não trazem password_hash.
-- Defina senhas com: npm run db:seed, POST /api/admin/set-password ou db:set-password.

-- E-mail admin canónico (atalho "admin" no login)
UPDATE public.users
SET email = 'admin@pontowebdesk.com'
WHERE lower(trim(email)) = 'admin@smartponto.com'
  AND NOT EXISTS (
    SELECT 1 FROM public.users u2
    WHERE lower(trim(u2.email)) = 'admin@pontowebdesk.com'
  );

-- ─── punches: compatibilidade API Node (schema Supabase usa employee_id) ───
ALTER TABLE public.punches ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE public.punches ADD COLUMN IF NOT EXISTS timestamp timestamptz;
ALTER TABLE public.punches ADD COLUMN IF NOT EXISTS punch_hash text;
ALTER TABLE public.punches ADD COLUMN IF NOT EXISTS payload jsonb;

UPDATE public.punches
SET user_id = employee_id::text
WHERE user_id IS NULL AND employee_id IS NOT NULL;

UPDATE public.punches
SET timestamp = created_at
WHERE timestamp IS NULL AND created_at IS NOT NULL;

UPDATE public.punches
SET payload = COALESCE(payload, raw_data, '{}'::jsonb)
WHERE payload IS NULL;

UPDATE public.punches
SET punch_hash = encode(
  digest(
    concat_ws('|', company_id, COALESCE(user_id, employee_id::text), type, COALESCE(timestamp::text, created_at::text)),
    'sha256'
  ),
  'hex'
)
WHERE punch_hash IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_punches_punch_hash_unique
  ON public.punches (punch_hash)
  WHERE punch_hash IS NOT NULL;

-- ─── Sequências (tabelas com serial/bigserial) ───────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      format('%I.%I', seq_ns.nspname, seq.relname) AS seq,
      format('%I.%I', tbl_ns.nspname, tbl.relname) AS tbl,
      att.attname AS col
    FROM pg_class seq
    JOIN pg_namespace seq_ns ON seq_ns.oid = seq.relnamespace
    JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype = 'a'
    JOIN pg_class tbl ON tbl.oid = dep.refobjid
    JOIN pg_namespace tbl_ns ON tbl_ns.oid = tbl.relnamespace
    JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = dep.refobjsubid
    WHERE seq.relkind = 'S'
      AND tbl_ns.nspname = 'public'
  LOOP
    EXECUTE format(
      'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %s), 1))',
      r.seq,
      r.col,
      r.tbl
    );
  END LOOP;
END $$;

COMMIT;
