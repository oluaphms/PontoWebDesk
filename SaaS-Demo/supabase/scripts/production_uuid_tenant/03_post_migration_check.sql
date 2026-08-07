-- Validação pós-migração 20260520170000 (somente leitura)

DO $$
BEGIN
  IF to_regclass('public._uuid_migration_company_map') IS NULL THEN
    RAISE EXCEPTION
      'Migração ainda não concluída: execute 20260520170000_production_uuid_multi_tenant_full.sql antes deste check.';
  END IF;
END $$;

-- 1) Nenhuma coluna company_id/tenant_id em TEXT
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('company_id', 'tenant_id')
  AND data_type IN ('text', 'character varying');

-- 2) companies.id é UUID
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'companies'
  AND column_name = 'id';

-- 3) Mapa de migração disponível
SELECT count(*) AS mapped_companies FROM public._uuid_migration_company_map;

-- 4) FKs para companies restauradas
SELECT
  tc.table_name AS child_table,
  tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND ccu.table_name = 'companies'
ORDER BY child_table;

-- 5) time_records: trigger Portaria 671 ativo
SELECT tgname, tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relname = 'time_records'
  AND NOT t.tgisinternal
  AND tgname = 'prevent_update_time_records';

-- 6) Batidas com tenant sem empresa (ex.: punches órfão — esperado se era legado)
SELECT 'time_records' AS tbl, count(*) AS rows_without_company
FROM public.time_records tr
WHERE tr.company_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = tr.company_id)
UNION ALL
SELECT 'punches', count(*)
FROM public.punches p
WHERE p.company_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p.company_id);
