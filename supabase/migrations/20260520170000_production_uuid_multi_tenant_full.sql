-- =============================================================================
-- PRODUÇÃO: migração completa company_id / tenant_id → UUID (multi-tenant)
-- Seguro, sequencial, com snapshot de policies/views e mapa legado→UUID.
-- Não altera regras de negócio; apenas tipos, RLS e funções de tenant.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Tabelas de auditoria / rollback lógico
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._uuid_migration_company_map (
  legacy_id text PRIMARY KEY,
  new_uuid uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public._uuid_migration_policy_backup (
  schemaname text NOT NULL,
  tablename text NOT NULL,
  policyname text NOT NULL,
  permissive text,
  roles text[],
  cmd text,
  qual text,
  with_check text,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schemaname, tablename, policyname)
);

CREATE TABLE IF NOT EXISTS public._uuid_migration_view_backup (
  viewname text PRIMARY KEY,
  definition text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public._uuid_migration_fk_backup (
  child_schema text NOT NULL,
  child_table text NOT NULL,
  constraint_name text NOT NULL,
  constraint_def text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_schema, child_table, constraint_name)
);

CREATE TABLE IF NOT EXISTS public._uuid_migration_trigger_backup (
  schemaname text NOT NULL,
  tablename text NOT NULL,
  triggername text NOT NULL,
  definition text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schemaname, tablename, triggername)
);

COMMENT ON TABLE public._uuid_migration_company_map IS
  'Mapa legado companies.id (text) → UUID. Mantido para rollback lógico pós-migração.';

-- ---------------------------------------------------------------------------
-- 1) ETAPA 1 — Snapshot policies + views (antes de dropar)
-- ---------------------------------------------------------------------------
INSERT INTO public._uuid_migration_policy_backup (
  schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
)
SELECT
  schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ON CONFLICT (schemaname, tablename, policyname) DO UPDATE SET
  permissive = EXCLUDED.permissive,
  roles = EXCLUDED.roles,
  cmd = EXCLUDED.cmd,
  qual = EXCLUDED.qual,
  with_check = EXCLUDED.with_check,
  backed_up_at = now();

INSERT INTO public._uuid_migration_view_backup (viewname, definition)
SELECT
  c.relname,
  pg_get_viewdef(c.oid, true)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'v'
ON CONFLICT (viewname) DO UPDATE SET
  definition = EXCLUDED.definition,
  backed_up_at = now();

DO $$
BEGIN
  IF (SELECT count(*) FROM public._uuid_migration_trigger_backup) = 0 THEN
    INSERT INTO public._uuid_migration_trigger_backup (schemaname, tablename, triggername, definition)
    SELECT
      n.nspname,
      c.relname,
      t.tgname,
      pg_get_triggerdef(t.oid, true)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Mapa legado → UUID (comp_* / tnt_* / UUID canônico; determinístico p/ legado)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO public._uuid_migration_company_map (legacy_id, new_uuid)
SELECT
  c.id,
  CASE
    WHEN c.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN c.id::uuid
    WHEN c.id ~* '^tnt_[0-9a-f]{32}$' THEN (
      substr(c.id, 5, 8) || '-' ||
      substr(c.id, 13, 4) || '-' ||
      substr(c.id, 17, 4) || '-' ||
      substr(c.id, 21, 4) || '-' ||
      substr(c.id, 25, 12)
    )::uuid
  -- comp_* e demais legados: UUID v5 determinístico (reprodutível / rollback previsível)
    ELSE uuid_generate_v5(
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
      'pontowebdesk:company:' || c.id
    )
  END
FROM public.companies c
ON CONFLICT (legacy_id) DO NOTHING;

-- Helper: legado TEXT → UUID (mesma regra do mapa companies)
CREATE OR REPLACE FUNCTION public._uuid_migration_legacy_to_uuid(p_legacy text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_legacy ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN p_legacy::uuid
    WHEN p_legacy ~* '^tnt_[0-9a-f]{32}$' THEN (
      substr(p_legacy, 5, 8) || '-' ||
      substr(p_legacy, 13, 4) || '-' ||
      substr(p_legacy, 17, 4) || '-' ||
      substr(p_legacy, 21, 4) || '-' ||
      substr(p_legacy, 25, 12)
    )::uuid
    ELSE uuid_generate_v5(
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
      'pontowebdesk:company:' || p_legacy
    )
  END;
$$;

-- Remove duplicatas que colidiriam na PK/UNIQUE após remap de company_id (ex.: current_operational_state)
CREATE OR REPLACE FUNCTION public._uuid_migration_dedupe_company_conflicts(p_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  con record;
  v_col text;
  v_group_expr text := '';
  v_order_col text;
  v_has_order boolean;
  v_sql text;
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'updated_at'
    ) THEN 'updated_at'
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'created_at'
    ) THEN 'created_at'
    ELSE NULL
  END INTO v_order_col;

  v_has_order := v_order_col IS NOT NULL;

  FOR con IN
    SELECT
      c.conname,
      array_agg(a.attname ORDER BY u.ord) AS attnames
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum AND NOT a.attisdropped
    WHERE n.nspname = 'public'
      AND t.relname = p_table
      AND c.contype IN ('p', 'u')
    GROUP BY c.oid, c.conname
    HAVING 'company_id' = ANY(array_agg(a.attname))
  LOOP
    v_group_expr := '';
    FOREACH v_col IN ARRAY con.attnames
    LOOP
      IF v_group_expr <> '' THEN
        v_group_expr := v_group_expr || ', ';
      END IF;
      IF v_col = 'company_id' THEN
        v_group_expr := v_group_expr ||
          'COALESCE(m.new_uuid::text, btrim(t.company_id::text))';
      ELSE
        v_group_expr := v_group_expr || format('t.%I', v_col);
      END IF;
    END LOOP;

    IF v_has_order THEN
      v_sql := format(
        $q$
          WITH mapped AS (
            SELECT
              t.ctid,
              row_number() OVER (
                PARTITION BY %s
                ORDER BY t.%I DESC NULLS LAST, t.ctid DESC
              ) AS rn
            FROM public.%I t
            LEFT JOIN public._uuid_migration_company_map m
              ON btrim(t.company_id::text) = m.legacy_id
          )
          DELETE FROM public.%I t
          USING mapped x
          WHERE t.ctid = x.ctid AND x.rn > 1
        $q$,
        v_group_expr, v_order_col, p_table, p_table
      );
    ELSE
      v_sql := format(
        $q$
          WITH mapped AS (
            SELECT
              t.ctid,
              row_number() OVER (
                PARTITION BY %s
                ORDER BY t.ctid DESC
              ) AS rn
            FROM public.%I t
            LEFT JOIN public._uuid_migration_company_map m
              ON btrim(t.company_id::text) = m.legacy_id
          )
          DELETE FROM public.%I t
          USING mapped x
          WHERE t.ctid = x.ctid AND x.rn > 1
        $q$,
        v_group_expr, p_table, p_table
      );
    END IF;

    EXECUTE v_sql;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2b) Mapear também company_id distintos em tabelas filhas (ex.: punches órfão)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_orphan_companies integer := 0;
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
        INSERT INTO public._uuid_migration_company_map (legacy_id, new_uuid)
        SELECT DISTINCT
          btrim(t.company_id::text),
          public._uuid_migration_legacy_to_uuid(btrim(t.company_id::text))
        FROM public.%I t
        WHERE t.company_id IS NOT NULL
          AND btrim(t.company_id::text) <> ''
        ON CONFLICT (legacy_id) DO NOTHING
      $q$,
      r.table_name
    );
  END LOOP;

  SELECT count(*)::integer INTO v_orphan_companies
  FROM public._uuid_migration_company_map m
  WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = m.legacy_id);

  IF v_orphan_companies > 0 THEN
    RAISE NOTICE
      'UUID migration: % legacy_id(s) mapeados só em tabelas filhas (sem companies.id). Ver _uuid_migration_company_map.',
      v_orphan_companies;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Pré-validação: ainda sem mapa após 2b → abortar (dado irrecuperável)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_orphans bigint;
  v_sql text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'companies') THEN
    RAISE NOTICE 'Tabela companies ausente; migração de tenant ignorada.';
    RETURN;
  END IF;

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
    v_sql := format(
      $q$
        SELECT count(*)::bigint
        FROM public.%I t
        WHERE t.company_id IS NOT NULL
          AND btrim(t.company_id::text) <> ''
          AND NOT EXISTS (
            SELECT 1 FROM public._uuid_migration_company_map m
            WHERE m.legacy_id = btrim(t.company_id::text)
          )
      $q$,
      r.table_name
    );
    EXECUTE v_sql INTO v_orphans;
    IF v_orphans > 0 THEN
      RAISE EXCEPTION 'Migração abortada: % registros sem mapa em public.% (company_id)',
        v_orphans, r.table_name;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4) ETAPA 2 — Remover TODAS as policies public (backup na etapa 1)
-- Inclui dependências cruzadas (ex.: punch_evidence_select → time_records.company_id).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5) ETAPA 2 — Remover views dependentes (schema public)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT viewname FROM pg_views WHERE schemaname = 'public' ORDER BY viewname DESC
  LOOP
    EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', v.viewname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Remover colunas tenant_id geradas (dependem de company_id TEXT)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'tenant_id'
      AND is_generated = 'ALWAYS'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP COLUMN IF EXISTS tenant_id', r.table_name);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7) Backup + remover FKs → companies(id) (backup preservado em re-run)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM public._uuid_migration_fk_backup) = 0 THEN
    INSERT INTO public._uuid_migration_fk_backup (child_schema, child_table, constraint_name, constraint_def)
    SELECT
      n.nspname,
      c.relname,
      con.conname,
      pg_get_constraintdef(con.oid, true)
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class ref ON ref.oid = con.confrelid
    JOIN pg_namespace refn ON refn.oid = ref.relnamespace
    WHERE con.contype = 'f'
      AND refn.nspname = 'public'
      AND ref.relname = 'companies';
  END IF;
END $$;

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT child_schema, child_table, constraint_name
    FROM public._uuid_migration_fk_backup
    WHERE child_schema = 'public'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
      fk.child_schema, fk.child_table, fk.constraint_name
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8) ETAPA 3 — Remapear valores TEXT → string UUID canônica (via mapa)
-- Portaria 671: desliga imutabilidade em time_records (só metadado company_id).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'time_records'
  ) THEN
    ALTER TABLE public.time_records DISABLE TRIGGER prevent_update_time_records;
  END IF;

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
  LOOP
    PERFORM public._uuid_migration_dedupe_company_conflicts(r.table_name);

    EXECUTE format(
      $q$
        UPDATE public.%I t
        SET company_id = m.new_uuid::text
        FROM public._uuid_migration_company_map m
        WHERE t.company_id IS NOT NULL
          AND btrim(t.company_id::text) = m.legacy_id
      $q$,
      r.table_name
    );
  END LOOP;

  -- tenant_id TEXT livre (não gerado)
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
      AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND c.data_type IN ('text', 'character varying')
      AND COALESCE(c.is_generated, 'NEVER') <> 'ALWAYS'
  LOOP
    EXECUTE format(
      $q$
        UPDATE public.%I t
        SET tenant_id = m.new_uuid::text
        FROM public._uuid_migration_company_map m
        WHERE t.tenant_id IS NOT NULL
          AND btrim(t.tenant_id::text) = m.legacy_id
      $q$,
      r.table_name
    );
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'time_records'
  ) THEN
    ALTER TABLE public.time_records ENABLE TRIGGER prevent_update_time_records;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'time_records'
    ) THEN
      ALTER TABLE public.time_records ENABLE TRIGGER prevent_update_time_records;
    END IF;
    RAISE;
END $$;

-- ---------------------------------------------------------------------------
-- 9) companies.id TEXT → UUID (nova PK)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'id'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies'
      AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS id_uuid uuid;

  UPDATE public.companies c
  SET id_uuid = m.new_uuid
  FROM public._uuid_migration_company_map m
  WHERE c.id = m.legacy_id;

  UPDATE public.companies SET id_uuid = id::uuid
  WHERE id_uuid IS NULL
    AND id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  IF EXISTS (SELECT 1 FROM public.companies WHERE id_uuid IS NULL) THEN
    RAISE EXCEPTION 'Migração abortada: companies.id sem mapeamento UUID';
  END IF;

  ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_pkey;
  ALTER TABLE public.companies DROP COLUMN id;
  ALTER TABLE public.companies RENAME COLUMN id_uuid TO id;
  ALTER TABLE public.companies ADD PRIMARY KEY (id);
END $$;

-- ---------------------------------------------------------------------------
-- 9b) Mapa + remapear resíduos TEXT (histórico append-only, re-run parcial)
-- Converte tudo para string UUID canônica antes do ALTER TYPE (sem subquery no USING).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_col text;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
      AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('company_id', 'tenant_id')
      AND c.data_type IN ('text', 'character varying')
      AND COALESCE(c.is_generated, 'NEVER') <> 'ALWAYS'
  LOOP
    v_col := r.column_name;

    EXECUTE format(
      $q$
        INSERT INTO public._uuid_migration_company_map (legacy_id, new_uuid)
        SELECT DISTINCT
          btrim(t.%1$I::text),
          public._uuid_migration_legacy_to_uuid(btrim(t.%1$I::text))
        FROM public.%2$I t
        WHERE t.%1$I IS NOT NULL
          AND btrim(t.%1$I::text) <> ''
          AND btrim(t.%1$I::text) !~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        ON CONFLICT (legacy_id) DO NOTHING
      $q$,
      v_col, r.table_name
    );

    EXECUTE format(
      $q$
        UPDATE public.%2$I t
        SET %1$I = m.new_uuid::text
        FROM public._uuid_migration_company_map m
        WHERE t.%1$I IS NOT NULL
          AND btrim(t.%1$I::text) = m.legacy_id
          AND btrim(t.%1$I::text) !~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      $q$,
      v_col, r.table_name
    );

    EXECUTE format(
      $q$
        UPDATE public.%2$I t
        SET %1$I = public._uuid_migration_legacy_to_uuid(btrim(t.%1$I::text))::text
        WHERE t.%1$I IS NOT NULL
          AND btrim(t.%1$I::text) <> ''
          AND btrim(t.%1$I::text) !~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      $q$,
      v_col, r.table_name
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 9c) Re-run seguro: policies + triggers removidos antes do ALTER TYPE
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM public._uuid_migration_trigger_backup) = 0 THEN
    INSERT INTO public._uuid_migration_trigger_backup (schemaname, tablename, triggername, definition)
    SELECT
      n.nspname,
      c.relname,
      t.tgname,
      pg_get_triggerdef(t.oid, true)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public';
  END IF;
END $$;

DO $$
DECLARE
  pol record;
  trg record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;

  FOR trg IN
    SELECT n.nspname AS schemaname, c.relname AS tablename, t.tgname AS triggername
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND n.nspname = 'public'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I.%I',
      trg.triggername, trg.schemaname, trg.tablename
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 10) ETAPA 3+4 — ALTER COLUMN company_id / tenant_id → UUID + NOT NULL onde aplicável
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_bad bigint;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name, c.is_nullable
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
      AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('company_id', 'tenant_id')
      AND c.data_type IN ('text', 'character varying')
      AND NOT (c.table_name = 'companies' AND c.column_name = 'id')
  LOOP
    EXECUTE format(
      $q$
        SELECT count(*)::bigint FROM public.%1$I
        WHERE %2$I IS NOT NULL
          AND btrim(%2$I::text) <> ''
          AND btrim(%2$I::text) !~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      $q$,
      r.table_name,
      r.column_name
    ) INTO v_bad;

    IF v_bad > 0 THEN
      RAISE EXCEPTION
        'Migração abortada: % valores % ainda não UUID em public.% (etapa 9b)',
        v_bad, r.column_name, r.table_name;
    END IF;

    EXECUTE format(
      $q$
        ALTER TABLE public.%1$I ALTER COLUMN %2$I TYPE uuid USING (
          CASE
            WHEN NULLIF(btrim(%2$I::text), '') IS NULL THEN NULL::uuid
            ELSE btrim(%2$I::text)::uuid
          END
        )
      $q$,
      r.table_name,
      r.column_name
    );

    IF r.is_nullable = 'NO' THEN
      EXECUTE format(
        $q$
          SELECT count(*)::bigint FROM public.%I
          WHERE %I IS NULL
        $q$,
        r.table_name, r.column_name
      ) INTO v_bad;

      IF v_bad > 0 THEN
        RAISE EXCEPTION
          'Migração abortada: % registros com % NULL em public.% (coluna NOT NULL)',
          v_bad, r.column_name, r.table_name;
      END IF;

      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL',
        r.table_name, r.column_name
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 10b) Restaurar triggers (definições salvas na etapa 1)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  trg record;
BEGIN
  FOR trg IN
    SELECT schemaname, tablename, triggername, definition
    FROM public._uuid_migration_trigger_backup
    WHERE schemaname = 'public'
    ORDER BY tablename, triggername
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = trg.schemaname AND table_name = trg.tablename
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I.%I',
      trg.triggername, trg.schemaname, trg.tablename
    );

    BEGIN
      EXECUTE trg.definition;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'Trigger % em %.% não restaurado: %',
          trg.triggername, trg.schemaname, trg.tablename, SQLERRM;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 11) Recriar tenant_id gerado (UUID) onde havia espelho de company_id
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'id' AND data_type = 'uuid'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE public.companies
      ADD COLUMN tenant_id uuid GENERATED ALWAYS AS (id) STORED;
  END IF;

  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
      AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'company_id'
      AND c.data_type = 'uuid'
      AND c.table_name <> 'companies'
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns x
        WHERE x.table_schema = 'public'
          AND x.table_name = c.table_name
          AND x.column_name = 'tenant_id'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN tenant_id uuid GENERATED ALWAYS AS (company_id) STORED',
      r.table_name
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 12) Funções de tenant → retorno UUID (sem cast em policies)
-- PostgreSQL não permite ALTER do tipo de retorno: DROP + CREATE.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.operational_tenant_id() CASCADE;
DROP FUNCTION IF EXISTS public.get_my_tenant_id() CASCADE;
DROP FUNCTION IF EXISTS public.get_my_company_id() CASCADE;

CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_my_company_id() IS
  'Retorna company_id (UUID) do usuário autenticado; usada em RLS sem recursão.';

CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_my_company_id();
$$;

COMMENT ON FUNCTION public.get_my_tenant_id() IS
  'Alias UUID de get_my_company_id() para isolamento multi-tenant.';

CREATE OR REPLACE FUNCTION public.operational_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(btrim(auth.jwt() ->> 'company_id'), '')::uuid,
    NULLIF(btrim(current_setting('request.jwt.claim.company_id', true)), '')::uuid,
    public.get_my_company_id()
  );
$$;

COMMENT ON FUNCTION public.operational_tenant_id() IS
  'Tenant UUID: claim JWT, depois get_my_company_id().';

DO $$
DECLARE
  tbl_owner name;
BEGIN
  SELECT tableowner INTO tbl_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'users'
  LIMIT 1;

  IF tbl_owner IS NOT NULL THEN
    EXECUTE format('ALTER FUNCTION public.get_my_company_id() OWNER TO %I', tbl_owner);
    EXECUTE format('ALTER FUNCTION public.get_my_tenant_id() OWNER TO %I', tbl_owner);
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    ALTER FUNCTION public.get_my_company_id() OWNER TO supabase_admin;
    ALTER FUNCTION public.get_my_tenant_id() OWNER TO supabase_admin;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 13) ETAPA 5+7 — Restaurar policies do backup (expressões UUID-safe) + fallback
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._uuid_migration_fixup_policy_expr(p_expr text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := COALESCE(p_expr, '');
BEGIN
  IF v = '' THEN
    RETURN NULL;
  END IF;

  v := replace(v, 'nullif(public.get_my_company_id(), '''')::uuid', 'public.get_my_company_id()');
  v := replace(v, 'NULLIF(public.get_my_company_id(), '''')::uuid', 'public.get_my_company_id()');
  v := replace(
    v,
    '(SELECT company_id FROM public.users WHERE id = auth.uid())',
    'public.get_my_company_id()'
  );
  v := replace(
    v,
    '(SELECT company_id FROM public.users WHERE id = auth.uid() LIMIT 1)',
    'public.get_my_company_id()'
  );
  v := replace(
    v,
    '(SELECT u.company_id FROM public.users u WHERE u.id = auth.uid() LIMIT 1)',
    'public.get_my_company_id()'
  );

  RETURN v;
END;
$$;

DO $$
DECLARE
  pol record;
  v_qual text;
  v_check text;
  v_roles text;
  v_sql text;
  v_permissive text;
BEGIN
  FOR pol IN
    SELECT *
    FROM public._uuid_migration_policy_backup
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = pol.tablename
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', pol.tablename);

    v_qual := public._uuid_migration_fixup_policy_expr(pol.qual);
    v_check := public._uuid_migration_fixup_policy_expr(pol.with_check);
    v_permissive := CASE WHEN lower(COALESCE(pol.permissive, 'PERMISSIVE')) = 'restrictive' THEN 'RESTRICTIVE' ELSE 'PERMISSIVE' END;

    IF pol.roles IS NULL OR array_length(pol.roles, 1) IS NULL THEN
      v_roles := 'PUBLIC';
    ELSE
      v_roles := array_to_string(pol.roles, ', ');
    END IF;

    v_sql := format(
      'CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
      pol.policyname,
      pol.tablename,
      v_permissive,
      pol.cmd,
      v_roles
    );

    IF v_qual IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', v_qual);
    END IF;

    IF v_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', v_check);
    END IF;

    BEGIN
      EXECUTE v_sql;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Policy % em % não restaurada: %', pol.policyname, pol.tablename, SQLERRM;
    END;
  END LOOP;
END $$;

-- Fallback: tabelas com company_id UUID sem nenhuma policy
DO $$
DECLARE
  r record;
  pol_name text;
  v_count integer;
BEGIN
  FOR r IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
      AND t.table_name = c.table_name
      AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'company_id'
      AND c.data_type = 'uuid'
  LOOP
    SELECT count(*)::integer INTO v_count
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = r.table_name;

    IF v_count > 0 THEN
      CONTINUE;
    END IF;

    pol_name := r.table_name || '_tenant_isolation';
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);

    IF r.table_name = 'companies' THEN
      EXECUTE format(
        $p$
          CREATE POLICY %I ON public.companies
          FOR ALL TO authenticated
          USING (
            id IS NOT DISTINCT FROM public.get_my_company_id()
            AND public.get_my_company_id() IS NOT NULL
          )
          WITH CHECK (
            id IS NOT DISTINCT FROM public.get_my_company_id()
            AND public.get_my_company_id() IS NOT NULL
          )
        $p$,
        pol_name
      );
      CONTINUE;
    END IF;

    IF r.table_name = 'users' THEN
      EXECUTE $p$
        CREATE POLICY users_tenant_isolation_select ON public.users
        FOR SELECT TO authenticated
        USING (
          id = auth.uid()
          OR (
            company_id IS NOT DISTINCT FROM public.get_my_company_id()
            AND public.get_my_company_id() IS NOT NULL
          )
        )
      $p$;
      CONTINUE;
    END IF;

    EXECUTE format(
      $p$
        CREATE POLICY %I ON public.%I
        FOR ALL TO authenticated
        USING (
          company_id IS NOT DISTINCT FROM public.get_my_company_id()
          AND public.get_my_company_id() IS NOT NULL
        )
        WITH CHECK (
          company_id IS NOT DISTINCT FROM public.get_my_company_id()
          AND public.get_my_company_id() IS NOT NULL
        )
      $p$,
      pol_name, r.table_name
    );
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public._uuid_migration_fixup_policy_expr(text);

-- ---------------------------------------------------------------------------
-- 14) ETAPA 6 — Recriar views (sem SECURITY DEFINER; definição salva)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT viewname, definition
    FROM public._uuid_migration_view_backup
    ORDER BY viewname
  LOOP
    BEGIN
      EXECUTE format('CREATE OR REPLACE VIEW public.%I AS %s', v.viewname, v.definition);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'View % não recriada automaticamente: %', v.viewname, SQLERRM;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 15) ETAPA 8 — Validação pós-migração (falha se restar TEXT)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_left integer;
BEGIN
  SELECT count(*)::integer INTO v_left
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND column_name IN ('company_id', 'tenant_id')
    AND data_type IN ('text', 'character varying');

  IF v_left > 0 THEN
    RAISE EXCEPTION 'Validação falhou: % colunas company_id/tenant_id ainda são TEXT', v_left;
  END IF;
END $$;

-- Relatório (visível nos logs da migração)
DO $$
DECLARE
  v_tables integer;
  v_policies integer;
BEGIN
  SELECT count(DISTINCT table_name)::integer INTO v_tables
  FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name = 'company_id' AND data_type = 'uuid';

  SELECT count(*)::integer INTO v_policies
  FROM pg_policies
  WHERE schemaname = 'public' AND policyname LIKE '%tenant_isolation%';

  RAISE NOTICE 'UUID migration OK: % tabelas com company_id UUID; % policies tenant_isolation', v_tables, v_policies;
END $$;

-- ---------------------------------------------------------------------------
-- 16) Recriar FKs → companies(id) a partir do backup (devices, holidays, etc.)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM public._uuid_migration_fk_backup) = 0 THEN
    INSERT INTO public._uuid_migration_fk_backup (child_schema, child_table, constraint_name, constraint_def)
    VALUES
      ('public', 'devices', 'devices_company_id_fkey',
        'FOREIGN KEY (company_id) REFERENCES companies(id)'),
      ('public', 'employee_absences', 'employee_absences_company_id_fkey',
        'FOREIGN KEY (company_id) REFERENCES companies(id)'),
      ('public', 'holidays', 'holidays_company_id_fkey',
        'FOREIGN KEY (company_id) REFERENCES companies(id)'),
      ('public', 'work_locations', 'work_locations_company_id_fkey',
        'FOREIGN KEY (company_id) REFERENCES companies(id)'),
      ('public', 'folga_requests', 'folga_requests_company_id_fkey',
        'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE'),
      ('public', 'falta_requests', 'falta_requests_company_id_fkey',
        'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE'),
      ('public', 'employee_invites', 'employee_invites_company_id_fkey',
        'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT child_schema, child_table, constraint_name, constraint_def
    FROM public._uuid_migration_fk_backup
    WHERE child_schema = 'public'
    ORDER BY child_table, constraint_name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = fk.child_schema AND table_name = fk.child_table
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
      fk.child_schema, fk.child_table, fk.constraint_name
    );

    BEGIN
      EXECUTE format(
        'ALTER TABLE %I.%I ADD CONSTRAINT %I %s',
        fk.child_schema,
        fk.child_table,
        fk.constraint_name,
        fk.constraint_def
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'FK % em %.% não recriada: %',
          fk.constraint_name, fk.child_schema, fk.child_table, SQLERRM;
    END;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 17) Onboarding: companies.id agora é UUID nativo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tenant_onboarding(
  p_nome text,
  p_slug text,
  p_plan text DEFAULT 'free'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid uuid;
  v_settings jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.company_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Usuário já vinculado a um tenant';
  END IF;

  v_tid := gen_random_uuid();
  v_settings := jsonb_build_object(
    'fence', jsonb_build_object('lat', -23.5614, 'lng', -46.6559, 'radius', 150),
    'allowManualPunch', true,
    'requirePhoto', false,
    'standardHours', jsonb_build_object('start', '09:00', 'end', '18:00'),
    'delayPolicy', jsonb_build_object('toleranceMinutes', 15)
  );

  INSERT INTO public.companies (
    id, nome, name, slug, settings, plan, journey_settings, created_at, updated_at
  ) VALUES (
    v_tid,
    p_nome,
    p_nome,
    p_slug,
    v_settings,
    COALESCE(nullif(trim(p_plan), ''), 'free'),
    jsonb_build_object(
      'dailyMinutes', 480,
      'weeklyMinutes', 2400,
      'lateToleranceMinutes', 15,
      'timeBankEnabled', true,
      'overtimePolicy', 'clt_default',
      'mandatoryBreakMinutes', 60
    ),
    now(),
    now()
  );

  UPDATE public.users
  SET company_id = v_tid
  WHERE id = auth.uid();

  INSERT INTO public.system_settings (company_id, key, value)
  VALUES (v_tid, 'journey', '{}'::jsonb)
  ON CONFLICT (company_id, key) DO NOTHING;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenant_audit_log') THEN
    INSERT INTO public.tenant_audit_log (tenant_id, user_id, action, details)
    VALUES (v_tid, auth.uid(), 'tenant_onboarding', jsonb_build_object('slug', p_slug, 'plan', COALESCE(p_plan, 'free')));
  END IF;

  RETURN jsonb_build_object('tenant_id', v_tid, 'ok', true);
END;
$$;

-- Garantir policy de insert em companies (novo tenant sem vínculo)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'companies'
      AND policyname = 'companies_insert_authenticated'
  ) THEN
    CREATE POLICY companies_insert_authenticated ON public.companies
      FOR INSERT TO authenticated
      WITH CHECK (
        NOT EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
            AND u.company_id IS NOT NULL
        )
      );
  END IF;
END $$;

DROP FUNCTION IF EXISTS public._uuid_migration_dedupe_company_conflicts(text);
DROP FUNCTION IF EXISTS public._uuid_migration_legacy_to_uuid(text);
