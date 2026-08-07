-- Limpeza de batidas de teste REP — ELEN DE OLIVEIRA CUNHA (17–19/06/2026)
--
-- Uso na VPS:
--   cd /root/PontoWebDesk/backend
--   export DATABASE_URL="$(grep -E '^[[:space:]]*DATABASE_URL=' .env | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
--
--   # Só diagnóstico (seguro):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ../supabase/scripts/cleanup-elen-rep-test-records.sql
--
--   # Remover duplicatas (mantém jornada canônica):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v cleanup_mode=dedupe -f ../supabase/scripts/cleanup-elen-rep-test-records.sql
--
--   # Limpar tudo na janela para repetir teste 18/06:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v cleanup_mode=full_retest -f ../supabase/scripts/cleanup-elen-rep-test-records.sql
--
-- cleanup_mode: preview | dedupe | full_retest  (padrão: preview)

\set ON_ERROR_STOP on
\if :{?cleanup_mode}
\else
  \set cleanup_mode preview
\endif

-- psql não substitui :'var' dentro de DO $$ — passa o modo via GUC
SELECT set_config('app.cleanup_mode', :'cleanup_mode', false);

-- =============================================================================
-- 1) DIAGNÓSTICO
-- =============================================================================

SELECT u.id AS user_id, u.nome, u.company_id
FROM public.users u
WHERE u.nome ILIKE '%ELEN DE OLIVEIRA CUNHA%'
LIMIT 5;

SELECT
  tr.id,
  tr.type,
  tr.source,
  tr.method,
  tr.nsr,
  tr.timestamp AT TIME ZONE 'America/Sao_Paulo' AS horario_brt,
  tr.created_at AT TIME ZONE 'America/Sao_Paulo' AS ingestao_brt
FROM public.time_records tr
JOIN public.users u ON u.id::text = tr.user_id::text
WHERE u.nome ILIKE '%ELEN DE OLIVEIRA CUNHA%'
  AND tr.timestamp >= TIMESTAMPTZ '2026-06-17 00:00:00-03'
  AND tr.timestamp <  TIMESTAMPTZ '2026-06-20 00:00:00-03'
ORDER BY tr.timestamp ASC;

SELECT
  rpl.id AS log_id,
  rpl.nsr,
  rpl.tipo_marcacao,
  rpl.data_hora AT TIME ZONE 'America/Sao_Paulo' AS horario_brt,
  rpl.time_record_id
FROM public.rep_punch_logs rpl
JOIN public.users u ON u.id::text = rpl.resolved_user_id::text
WHERE u.nome ILIKE '%ELEN DE OLIVEIRA CUNHA%'
  AND rpl.data_hora >= TIMESTAMPTZ '2026-06-17 00:00:00-03'
  AND rpl.data_hora <  TIMESTAMPTZ '2026-06-20 00:00:00-03'
ORDER BY rpl.data_hora ASC;

-- =============================================================================
-- 2) LIMPEZA (cleanup_mode = dedupe | full_retest)
-- =============================================================================

DO $$
DECLARE
  v_mode text := current_setting('app.cleanup_mode', true);
  v_user_id uuid;
  v_drop_ids text[];
  v_dedupe_ids text[] := ARRAY[
    'c0747604-19a5-46e2-ab12-3bc64fe10010',
    'c9cb9a10-8dd4-4c82-af7e-550582b89fa1',
    '3254227f-74b3-4ed8-859c-f462755e1162',
    '921e076e-f5dc-4b23-aa8d-2c10866c4bbf'
  ];
  v_id text;
  v_has_trigger boolean := false;
BEGIN
  IF v_mode = 'preview' THEN
    RAISE NOTICE 'Modo preview — nenhuma exclusão. Use -v cleanup_mode=dedupe ou full_retest para limpar.';
    RETURN;
  END IF;

  IF v_mode NOT IN ('dedupe', 'full_retest') THEN
    RAISE EXCEPTION 'cleanup_mode inválido: % (use preview, dedupe ou full_retest)', v_mode;
  END IF;

  SELECT u.id INTO v_user_id
  FROM public.users u
  WHERE u.nome ILIKE '%ELEN DE OLIVEIRA CUNHA%'
  ORDER BY (
    SELECT count(*)::int
    FROM public.time_records tr
    WHERE tr.user_id::text = u.id::text
      AND tr.timestamp >= TIMESTAMPTZ '2026-06-17 00:00:00-03'
      AND tr.timestamp < TIMESTAMPTZ '2026-06-20 00:00:00-03'
  ) DESC,
  u.nome
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Colaboradora ELEN não encontrada';
  END IF;

  RAISE NOTICE 'Colaborador selecionado: %', v_user_id;

  IF v_mode = 'dedupe' THEN
    SELECT array_agg(tr.id ORDER BY tr.timestamp)
    INTO v_drop_ids
    FROM public.time_records tr
    WHERE tr.user_id::text = v_user_id::text
      AND (
        tr.id = ANY (v_dedupe_ids)
        -- Fantasma AFD: NSR 16641 com data civil 18/06 01:00 (canônico é 19/06 01:00 NSR 16652)
        OR (
          tr.nsr = 16641
          AND (tr.timestamp AT TIME ZONE 'America/Sao_Paulo')::date = DATE '2026-06-18'
          AND EXTRACT(HOUR FROM tr.timestamp AT TIME ZONE 'America/Sao_Paulo') < 12
        )
      );
  ELSE
    SELECT array_agg(tr.id ORDER BY tr.timestamp)
    INTO v_drop_ids
    FROM public.time_records tr
    WHERE tr.user_id::text = v_user_id::text
      AND tr.timestamp >= TIMESTAMPTZ '2026-06-17 00:00:00-03'
      AND tr.timestamp <  TIMESTAMPTZ '2026-06-20 00:00:00-03';
  END IF;

  IF v_drop_ids IS NULL OR array_length(v_drop_ids, 1) IS NULL THEN
    RAISE NOTICE 'Nenhum registro a remover (modo %).', v_mode;
    RETURN;
  END IF;

  RAISE NOTICE 'Modo % — removendo % registro(s):', v_mode, array_length(v_drop_ids, 1);
  FOREACH v_id IN ARRAY v_drop_ids LOOP
    RAISE NOTICE '  DROP %', v_id;
  END LOOP;

  UPDATE public.rep_punch_logs l
  SET time_record_id = NULL
  WHERE l.time_record_id = ANY (v_drop_ids);

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'time_records' AND t.tgname = 'prevent_delete_time_records' AND NOT t.tgisinternal
  ) INTO v_has_trigger;

  IF v_has_trigger THEN
    EXECUTE 'ALTER TABLE public.time_records DISABLE TRIGGER prevent_delete_time_records';
  END IF;

  DELETE FROM public.time_records tr
  WHERE tr.id = ANY (v_drop_ids);

  IF v_has_trigger THEN
    EXECUTE 'ALTER TABLE public.time_records ENABLE TRIGGER prevent_delete_time_records';
  END IF;

  RAISE NOTICE 'Limpeza concluída (modo %).', v_mode;
  IF v_mode = 'full_retest' THEN
    RAISE NOTICE 'Próximo passo: repetir batidas no relógio (18/06 22h, 19/06 01h/02h/07h24) e reimportar AFD.';
  END IF;
END $$;

-- Após aplicar migration 20260619180000 e reimportar, reclassificar tipos da jornada:
-- SELECT public.reclassify_operational_journey_types(
--   'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'::uuid,
--   'a96ae0cd-c0fd-4f70-a8c3-7714b49f1ce5'::uuid,
--   '2026-06-18'::date
-- );
