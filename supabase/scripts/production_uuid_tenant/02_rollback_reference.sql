-- Rollback LÓGICO — executar SOMENTE APÓS a migração 20260520170000 ter concluído COM SUCESSO.
-- Erro "Tabelas de auditoria ausentes" = migração não terminou; rode o SQL da migração primeiro.

DO $$
BEGIN
  IF to_regclass('public._uuid_migration_company_map') IS NULL THEN
    RAISE EXCEPTION
      'Tabelas de auditoria ausentes. Execute primeiro: supabase/migrations/20260520170000_production_uuid_multi_tenant_full.sql';
  END IF;
END $$;

-- Mapeamento legado → UUID
SELECT legacy_id, new_uuid, created_at
FROM public._uuid_migration_company_map
ORDER BY created_at;

-- IDs mapeados só em tabelas filhas (UUID sem linha correspondente em companies após migração)
SELECT m.legacy_id, m.new_uuid
FROM public._uuid_migration_company_map m
WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = m.new_uuid)
ORDER BY m.legacy_id;

-- Policies originais (antes da migração)
SELECT tablename, policyname, cmd, qual, with_check
FROM public._uuid_migration_policy_backup
ORDER BY tablename, policyname;

-- Views originais
SELECT viewname, left(definition, 200) AS definition_preview
FROM public._uuid_migration_view_backup
ORDER BY viewname;

-- Triggers originais
SELECT tablename, triggername, left(definition, 200) AS definition_preview
FROM public._uuid_migration_trigger_backup
ORDER BY tablename, triggername;
