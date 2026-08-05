-- Executar na VPS ANTES de importar dados do Supabase.
-- NÃO altera schema — apenas remove dados de teste/seed.
-- Manter: public._schema_migrations (histórico db:migrate:full)

BEGIN;

-- Remover admin de seed local (evita conflito de email/id com dados reais)
DELETE FROM public.users
WHERE lower(email) IN (
  lower(coalesce(current_setting('app.seed_admin_email', true), 'admin@local.test'))
);

DELETE FROM auth.users
WHERE lower(email) IN (
  lower(coalesce(current_setting('app.seed_admin_email', true), 'admin@local.test'))
);

-- Limpar dados operacionais (preserva estrutura e _schema_migrations)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('_schema_migrations')
    ORDER BY tablename
  LOOP
    EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', r.tablename);
  END LOOP;
END $$;

-- auth.users (perfis Supabase; public.users referencia via FK)
TRUNCATE auth.users RESTART IDENTITY CASCADE;

-- Metadados de ficheiros (opcional; reimporta com dump se incluir schema storage)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
    TRUNCATE storage.objects RESTART IDENTITY CASCADE;
  END IF;
END $$;

COMMIT;
