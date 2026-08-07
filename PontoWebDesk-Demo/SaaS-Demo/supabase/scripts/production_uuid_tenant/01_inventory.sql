-- ETAPA 1 — Inventário (somente leitura). Executar ANTES da migração 20260520170000.
-- Não altera dados. Não depende de _uuid_migration_* (criadas só na migração).

-- 1) Colunas company_id / tenant_id
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('company_id', 'tenant_id')
ORDER BY table_name, column_name;

-- 2) Empresas cadastradas
SELECT id AS legacy_company_id, nome, created_at
FROM public.companies
ORDER BY created_at NULLS LAST;

-- 2b) company_id órfãos: existem em tabelas filhas mas NÃO em companies.id
DROP TABLE IF EXISTS _inventory_orphans;
CREATE TEMP TABLE _inventory_orphans (
  table_name text NOT NULL,
  company_id text NOT NULL,
  row_count bigint NOT NULL
);

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
      AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'company_id'
      AND c.data_type IN ('text', 'character varying')
      AND c.table_name <> 'companies'
  LOOP
    EXECUTE format(
      $q$
        INSERT INTO _inventory_orphans (table_name, company_id, row_count)
        SELECT %L, btrim(t.company_id::text), count(*)::bigint
        FROM public.%I t
        WHERE t.company_id IS NOT NULL
          AND btrim(t.company_id::text) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM public.companies c WHERE c.id = btrim(t.company_id::text)
          )
        GROUP BY btrim(t.company_id::text)
      $q$,
      r.table_name, r.table_name
    );
  END LOOP;
END $$;

SELECT table_name, company_id, row_count
FROM _inventory_orphans
ORDER BY table_name, row_count DESC;

-- 2c) Resumo (deve ficar vazio após migração corrigida; órfãos serão mapeados via UUID v5)
SELECT coalesce(sum(row_count), 0) AS total_orphan_rows
FROM _inventory_orphans;

-- 3) Policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 4) Views
SELECT viewname, definition
FROM pg_views
WHERE schemaname = 'public'
ORDER BY viewname;

-- 5) FKs apontando para companies(id)
SELECT
  tc.table_name AS child_table,
  kcu.column_name AS child_column,
  ccu.table_name AS parent_table,
  ccu.column_name AS parent_column,
  tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND ccu.table_name = 'companies'
ORDER BY child_table;
