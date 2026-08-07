-- DRY-RUN (somente leitura) para auditoria da limpeza de duplicidades REP/clock em time_records.
-- Não altera dados. Execute este SQL antes da migration de limpeza.
--
-- Opcional: filtre por empresa no CTE params (company_id); NULL = todas.

WITH params AS (
  SELECT NULL::text AS company_id
),
rep_rows AS (
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
  CROSS JOIN params p
  WHERE tr.nsr IS NOT NULL
    AND (p.company_id IS NULL OR tr.company_id = p.company_id)
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
    s.*,
    first_value(s.id) OVER (PARTITION BY s.signature ORDER BY s.created_at ASC, s.id ASC) AS keep_id,
    row_number() OVER (PARTITION BY s.signature ORDER BY s.created_at ASC, s.id ASC) AS rn,
    count(*) OVER (PARTITION BY s.signature) AS grp_size
  FROM signature_rows s
),
duplicates AS (
  SELECT *
  FROM ranked
  WHERE rn > 1
)
SELECT
  d.company_id,
  count(*) AS records_to_remove,
  count(DISTINCT d.signature) AS duplicate_groups,
  count(DISTINCT d.user_id) AS affected_users
FROM duplicates d
GROUP BY d.company_id
ORDER BY records_to_remove DESC, d.company_id;

-- Amostra detalhada dos duplicados que seriam removidos (com registro canônico preservado).
WITH params AS (
  SELECT NULL::text AS company_id
),
rep_rows AS (
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
  CROSS JOIN params p
  WHERE tr.nsr IS NOT NULL
    AND (p.company_id IS NULL OR tr.company_id = p.company_id)
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
    s.*,
    first_value(s.id) OVER (PARTITION BY s.signature ORDER BY s.created_at ASC, s.id ASC) AS keep_id,
    row_number() OVER (PARTITION BY s.signature ORDER BY s.created_at ASC, s.id ASC) AS rn,
    count(*) OVER (PARTITION BY s.signature) AS grp_size
  FROM signature_rows s
)
SELECT
  r.company_id,
  r.user_id,
  r.signature,
  r.nsr,
  r.type,
  r.event_ts,
  r.keep_id,
  r.id AS drop_id,
  r.grp_size
FROM ranked r
WHERE r.rn > 1
ORDER BY r.company_id, r.signature, r.created_at, r.id
LIMIT 300;

-- Impacto por tabela de referência (quantas linhas precisariam ser reapontadas para keep_id).
-- Continua sendo DRY-RUN: sem UPDATE/DELETE em tabelas de negócio.
CREATE TEMP TABLE tmp_rep_dedup_drop_ids (
  drop_id text PRIMARY KEY,
  keep_id text NOT NULL
) ON COMMIT DROP;

WITH params AS (
  SELECT NULL::text AS company_id
),
rep_rows AS (
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
  CROSS JOIN params p
  WHERE tr.nsr IS NOT NULL
    AND (p.company_id IS NULL OR tr.company_id = p.company_id)
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
INSERT INTO tmp_rep_dedup_drop_ids (drop_id, keep_id)
SELECT r.id, r.keep_id
FROM ranked r
WHERE r.rn > 1;

CREATE TEMP TABLE tmp_rep_dedup_ref_impact (
  ref_table text PRIMARY KEY,
  refs_to_repoint bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_rep_dedup_ref_impact (ref_table, refs_to_repoint) VALUES
  ('time_records (delete candidates)', 0),
  ('rep_punch_logs', 0),
  ('clock_event_logs', 0),
  ('point_receipts', 0),
  ('punch_evidence', 0),
  ('fraud_alerts', 0),
  ('time_adjustments', 0);

UPDATE tmp_rep_dedup_ref_impact
SET refs_to_repoint = (
  SELECT count(*)::bigint
  FROM tmp_rep_dedup_drop_ids
)
WHERE ref_table = 'time_records (delete candidates)';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rep_punch_logs' AND column_name = 'time_record_id'
  ) THEN
    UPDATE tmp_rep_dedup_ref_impact
    SET refs_to_repoint = (
      SELECT count(*)::bigint
      FROM public.rep_punch_logs l
      WHERE l.time_record_id IN (SELECT d.drop_id FROM tmp_rep_dedup_drop_ids d)
    )
    WHERE ref_table = 'rep_punch_logs';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clock_event_logs' AND column_name = 'time_record_id'
  ) THEN
    UPDATE tmp_rep_dedup_ref_impact
    SET refs_to_repoint = (
      SELECT count(*)::bigint
      FROM public.clock_event_logs l
      WHERE l.time_record_id IN (SELECT d.drop_id FROM tmp_rep_dedup_drop_ids d)
    )
    WHERE ref_table = 'clock_event_logs';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'point_receipts' AND column_name = 'time_record_id'
  ) THEN
    UPDATE tmp_rep_dedup_ref_impact
    SET refs_to_repoint = (
      SELECT count(*)::bigint
      FROM public.point_receipts l
      WHERE l.time_record_id IN (SELECT d.drop_id FROM tmp_rep_dedup_drop_ids d)
    )
    WHERE ref_table = 'point_receipts';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'punch_evidence' AND column_name = 'time_record_id'
  ) THEN
    UPDATE tmp_rep_dedup_ref_impact
    SET refs_to_repoint = (
      SELECT count(*)::bigint
      FROM public.punch_evidence l
      WHERE l.time_record_id IN (SELECT d.drop_id FROM tmp_rep_dedup_drop_ids d)
    )
    WHERE ref_table = 'punch_evidence';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fraud_alerts' AND column_name = 'time_record_id'
  ) THEN
    UPDATE tmp_rep_dedup_ref_impact
    SET refs_to_repoint = (
      SELECT count(*)::bigint
      FROM public.fraud_alerts l
      WHERE l.time_record_id IN (SELECT d.drop_id FROM tmp_rep_dedup_drop_ids d)
    )
    WHERE ref_table = 'fraud_alerts';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'time_adjustments' AND column_name = 'time_record_id'
  ) THEN
    UPDATE tmp_rep_dedup_ref_impact
    SET refs_to_repoint = (
      SELECT count(*)::bigint
      FROM public.time_adjustments l
      WHERE l.time_record_id IN (SELECT d.drop_id FROM tmp_rep_dedup_drop_ids d)
    )
    WHERE ref_table = 'time_adjustments';
  END IF;
END $$;

SELECT ref_table, refs_to_repoint
FROM tmp_rep_dedup_ref_impact
ORDER BY refs_to_repoint DESC, ref_table;

