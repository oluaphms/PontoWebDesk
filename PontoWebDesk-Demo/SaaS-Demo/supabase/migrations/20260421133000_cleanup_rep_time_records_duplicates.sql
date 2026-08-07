-- Limpeza de duplicidades históricas em time_records para batidas REP/clock.
-- Mantém 1 registro canônico por assinatura e reaponta referências conhecidas.
-- Segurança:
-- - Idempotente (pode rodar mais de uma vez sem efeitos colaterais).
-- - Só considera registros com NSR e origem REP/clock (ou rep_id preenchido).
-- - Nunca toca registros manuais/admin sem assinatura de REP.

ALTER TABLE public.time_records
  ADD COLUMN IF NOT EXISTS rep_id TEXT;

DO $$
DECLARE
  v_map_count integer := 0;
  v_deleted_count integer := 0;
  v_has_delete_trigger boolean := false;
BEGIN
  CREATE TEMP TABLE tmp_rep_time_record_dedup_map (
    drop_id text PRIMARY KEY,
    keep_id text NOT NULL
  ) ON COMMIT DROP;

  WITH rep_rows AS (
    SELECT
      tr.id,
      tr.company_id,
      tr.user_id,
      tr.nsr,
      tr.type,
      tr.created_at,
      COALESCE(NULLIF(to_jsonb(tr)->>'timestamp', '')::timestamptz, tr.created_at) AS event_ts,
      NULLIF(BTRIM(tr.rep_id), '') AS rep_id_clean
    FROM public.time_records tr
    WHERE tr.nsr IS NOT NULL
      AND (
        NULLIF(BTRIM(tr.rep_id), '') IS NOT NULL
        OR lower(COALESCE(to_jsonb(tr)->>'source', '')) IN ('rep', 'clock')
        OR lower(COALESCE(to_jsonb(tr)->>'method', '')) IN ('rep', 'clock')
      )
  ),
  signature_rows AS (
    SELECT
      r.*,
      CASE
        WHEN r.rep_id_clean IS NOT NULL THEN
          'repid|' || r.company_id || '|' || r.rep_id_clean || '|' || r.nsr::text
        ELSE
          'fallback|' || r.company_id || '|' || COALESCE(r.user_id, '') || '|' || r.nsr::text || '|' ||
          COALESCE(lower(r.type), '') || '|' || date_trunc('second', r.event_ts)::text
      END AS signature
    FROM rep_rows r
  ),
  ranked AS (
    SELECT
      s.id,
      first_value(s.id) OVER (PARTITION BY s.signature ORDER BY s.created_at ASC, s.id ASC) AS keep_id,
      row_number() OVER (PARTITION BY s.signature ORDER BY s.created_at ASC, s.id ASC) AS rn
    FROM signature_rows s
  )
  INSERT INTO tmp_rep_time_record_dedup_map (drop_id, keep_id)
  SELECT r.id, r.keep_id
  FROM ranked r
  WHERE r.rn > 1;

  GET DIAGNOSTICS v_map_count = ROW_COUNT;

  IF v_map_count = 0 THEN
    RAISE NOTICE '[cleanup_rep_time_records_duplicates] Nenhuma duplicidade encontrada.';
    RETURN;
  END IF;

  -- Reaponta referências textuais para o registro canônico.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'rep_punch_logs'
      AND column_name = 'time_record_id'
  ) THEN
    UPDATE public.rep_punch_logs l
    SET time_record_id = m.keep_id
    FROM tmp_rep_time_record_dedup_map m
    WHERE l.time_record_id = m.drop_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'clock_event_logs'
      AND column_name = 'time_record_id'
  ) THEN
    UPDATE public.clock_event_logs l
    SET time_record_id = m.keep_id
    FROM tmp_rep_time_record_dedup_map m
    WHERE l.time_record_id = m.drop_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'point_receipts'
      AND column_name = 'time_record_id'
  ) THEN
    UPDATE public.point_receipts l
    SET time_record_id = m.keep_id
    FROM tmp_rep_time_record_dedup_map m
    WHERE l.time_record_id = m.drop_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'punch_evidence'
      AND column_name = 'time_record_id'
  ) THEN
    UPDATE public.punch_evidence l
    SET time_record_id = m.keep_id
    FROM tmp_rep_time_record_dedup_map m
    WHERE l.time_record_id = m.drop_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'fraud_alerts'
      AND column_name = 'time_record_id'
  ) THEN
    UPDATE public.fraud_alerts l
    SET time_record_id = m.keep_id
    FROM tmp_rep_time_record_dedup_map m
    WHERE l.time_record_id = m.drop_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'time_adjustments'
      AND column_name = 'time_record_id'
  ) THEN
    UPDATE public.time_adjustments l
    SET time_record_id = m.keep_id
    FROM tmp_rep_time_record_dedup_map m
    WHERE l.time_record_id = m.drop_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'time_records'
      AND t.tgname = 'prevent_delete_time_records'
      AND NOT t.tgisinternal
  ) INTO v_has_delete_trigger;

  IF v_has_delete_trigger THEN
    EXECUTE 'ALTER TABLE public.time_records DISABLE TRIGGER prevent_delete_time_records';
  END IF;

  DELETE FROM public.time_records tr
  USING tmp_rep_time_record_dedup_map m
  WHERE tr.id = m.drop_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  IF v_has_delete_trigger THEN
    EXECUTE 'ALTER TABLE public.time_records ENABLE TRIGGER prevent_delete_time_records';
  END IF;

  RAISE NOTICE '[cleanup_rep_time_records_duplicates] duplicados mapeados: %, removidos: %', v_map_count, v_deleted_count;

EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'time_records'
          AND t.tgname = 'prevent_delete_time_records'
          AND NOT t.tgisinternal
      ) THEN
        EXECUTE 'ALTER TABLE public.time_records ENABLE TRIGGER prevent_delete_time_records';
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
    RAISE;
END $$;

