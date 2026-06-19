#!/usr/bin/env python3
"""Gera migration rep night journey sequence operational."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

promote = (ROOT / "supabase/migrations/20260611130000_fix_rep_promote_pending_company_id_uuid.sql").read_text(
    encoding="utf-8"
)
old_promote = """    v_tipo_tr := CASE UPPER(LEFT(COALESCE(r.tipo_marcacao, 'E'), 1))
      WHEN 'E' THEN 'entrada'
      WHEN 'S' THEN 'saída'
      WHEN 'P' THEN 'pausa'
      ELSE 'entrada'
    END;

    v_is_late := FALSE;
    IF v_tipo_tr = 'entrada' AND v_user_uuid IS NOT NULL THEN
      v_local_ts := r.data_hora AT TIME ZONE 'America/Sao_Paulo';
      v_js_dow := DATE_PART('dow', v_local_ts)::int;
      v_sched_entry := NULL;
      v_tol := 0;
      v_sched_entry := (
        SELECT t.shift_start
        FROM public.ess_day_shift_times(v_user_uuid, v_cid, v_js_dow) t
        LIMIT 1
      );
      v_tol := COALESCE((
        SELECT t.tol
        FROM public.ess_day_shift_times(v_user_uuid, v_cid, v_js_dow) t
        LIMIT 1
      ), 0);

      IF v_sched_entry IS NOT NULL THEN
        v_entrada_mins :=
          DATE_PART('hour', v_local_ts)::int * 60 + DATE_PART('minute', v_local_ts)::int;
        v_start_mins :=
          DATE_PART('hour', v_sched_entry)::int * 60 + DATE_PART('minute', v_sched_entry)::int;
        v_is_late := v_entrada_mins > (v_start_mins + COALESCE(v_tol, 0));
      END IF;
    END IF;"""

new_promote = """    SELECT rt.resolved_type, rt.is_late
    INTO v_tipo_tr, v_is_late
    FROM public.rep_resolve_punch_type_operational(
      v_user_uuid,
      v_company_uuid,
      r.data_hora,
      r.tipo_marcacao
    ) rt;"""

if old_promote not in promote:
    raise SystemExit("promote block not found")
promote = promote.replace(old_promote, new_promote)

ingest = (ROOT / "supabase/migrations/20260522120000_rep_punch_hash_insert_guard.sql").read_text(encoding="utf-8")
old_ingest = """    v_existing_types := (
      SELECT array_agg(tr.type ORDER BY tr.timestamp)
      FROM public.time_records tr
      WHERE tr.company_id = v_company_uuid
        AND tr.user_id = v_user_uuid
        AND DATE(tr.timestamp AT TIME ZONE 'America/Sao_Paulo') = DATE(p_data_hora AT TIME ZONE 'America/Sao_Paulo')
    );"""
new_ingest = """    v_existing_types := public.rep_existing_types_operational_journey(
      v_user_uuid,
      v_company_uuid,
      p_data_hora
    );"""
if old_ingest not in ingest:
    raise SystemExit("ingest block not found")
ingest = ingest.replace(old_ingest, new_ingest)

seq = (ROOT / "supabase/migrations/20260508210000_normalize_rep_punch_letters_and_rep_dup_threshold.sql").read_text(
    encoding="utf-8"
)
seq = seq.replace(
    "v_day := (COALESCE(NEW.timestamp, NEW.created_at, NOW()) AT TIME ZONE 'America/Sao_Paulo')::date;",
    "v_day := public.time_record_operational_date_sp(NEW.user_id::uuid, NEW.company_id, COALESCE(NEW.timestamp, NEW.created_at, NOW()));",
)
seq = seq.replace(
    "AND (COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = v_day",
    "AND public.time_record_operational_date_sp(NEW.user_id::uuid, NEW.company_id, COALESCE(tr.timestamp, tr.created_at)) = v_day",
)

interpret = (ROOT / "supabase/migrations/20260417210000_interpret_punches_by_schedule.sql").read_text(encoding="utf-8")
interpret = re.sub(
    r"IF v_plan_st IS NULL THEN.*?END IF;\s*\n\s*-- Com escala configurada",
    """IF v_plan_st IS NULL THEN
    v_tipo_tr := public.rep_journey_type_for_position(v_existing_count);
    RETURN jsonb_build_object(
      'type', v_tipo_tr,
      'is_late', FALSE,
      'source', 'sequence_interpretation',
      'existing_count', v_existing_count
    );
  END IF;

  -- Com escala configurada""",
    interpret,
    count=1,
    flags=re.S,
)
interpret = re.sub(
    r"ELSIF v_existing_count = 1 THEN.*?ELSIF v_existing_count = 2 THEN",
    """ELSIF v_existing_count = 1 THEN
    v_tipo_tr := 'intervalo_saida';
  ELSIF v_existing_count = 2 THEN""",
    interpret,
    count=1,
    flags=re.S,
)
interpret = re.sub(
    r"ELSIF v_existing_count = 2 THEN.*?ELSIF v_existing_count = 3 THEN",
    """ELSIF v_existing_count = 2 THEN
    v_tipo_tr := 'intervalo_volta';
  ELSIF v_existing_count = 3 THEN""",
    interpret,
    count=1,
    flags=re.S,
)
interpret = interpret.replace("ELSIF v_existing_count = 3 THEN\n    v_tipo_tr := 'saída';", "ELSIF v_existing_count = 3 THEN\n    v_tipo_tr := 'saida';")

helpers = """
CREATE OR REPLACE FUNCTION public.rep_journey_type_for_position(p_position int)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE GREATEST(COALESCE(p_position, 0), 0)
    WHEN 0 THEN 'entrada'
    WHEN 1 THEN 'intervalo_saida'
    WHEN 2 THEN 'intervalo_volta'
    WHEN 3 THEN 'saida'
    ELSE CASE WHEN p_position % 2 = 0 THEN 'entrada' ELSE 'saida' END
  END;
$$;

CREATE OR REPLACE FUNCTION public.time_record_operational_date_sp(
  p_user_id uuid,
  p_company_id uuid,
  p_instant timestamptz
) RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_civil date;
  v_js_dow int;
  v_shift_start time;
  v_shift_end time;
  v_tol int;
  v_prev_dow int;
BEGIN
  v_civil := (p_instant AT TIME ZONE 'America/Sao_Paulo')::date;
  v_js_dow := EXTRACT(dow FROM (p_instant AT TIME ZONE 'America/Sao_Paulo'))::int;

  SELECT t.shift_start, t.shift_end, COALESCE(t.tol, 60)
  INTO v_shift_start, v_shift_end, v_tol
  FROM public.ess_day_shift_times(p_user_id, p_company_id::text, v_js_dow) t
  LIMIT 1;

  IF v_shift_start IS NOT NULL AND v_shift_end IS NOT NULL THEN
    RETURN public.resolve_operational_date_sp(p_instant, v_shift_start, v_shift_end, v_tol);
  END IF;

  v_prev_dow := CASE WHEN v_js_dow = 0 THEN 6 ELSE v_js_dow - 1 END;
  SELECT t.shift_start, t.shift_end, COALESCE(t.tol, 60)
  INTO v_shift_start, v_shift_end, v_tol
  FROM public.ess_day_shift_times(p_user_id, p_company_id::text, v_prev_dow) t
  LIMIT 1;

  IF v_shift_start IS NOT NULL AND v_shift_end IS NOT NULL
     AND public.is_night_shift_schedule(v_shift_start, v_shift_end) THEN
    RETURN public.resolve_operational_date_sp(p_instant, v_shift_start, v_shift_end, v_tol);
  END IF;

  RETURN v_civil;
END;
$$;

CREATE OR REPLACE FUNCTION public.rep_existing_types_operational_journey(
  p_user_id uuid,
  p_company_id uuid,
  p_instant timestamptz
) RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(tr.type ORDER BY COALESCE(tr.timestamp, tr.created_at), tr.id),
    ARRAY[]::text[]
  )
  FROM public.time_records tr
  WHERE tr.user_id = p_user_id
    AND tr.company_id = p_company_id
    AND public.time_record_operational_date_sp(
      p_user_id,
      p_company_id,
      COALESCE(tr.timestamp, tr.created_at)
    ) = public.time_record_operational_date_sp(p_user_id, p_company_id, p_instant);
$$;

CREATE OR REPLACE FUNCTION public.rep_resolve_punch_type_operational(
  p_user_id uuid,
  p_company_id uuid,
  p_instant timestamptz,
  p_tipo_marcacao text DEFAULT NULL
) RETURNS TABLE(resolved_type text, is_late boolean)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_marc text;
  v_existing text[];
  v_interp jsonb;
  v_type text;
  v_late boolean := false;
BEGIN
  v_marc := UPPER(LEFT(COALESCE(NULLIF(trim(p_tipo_marcacao), ''), 'E'), 1));
  IF v_marc NOT IN ('E', 'S', 'P', 'B') THEN
    v_marc := 'B';
  END IF;

  IF v_marc IN ('S', 'P')
     AND p_tipo_marcacao IS NOT NULL
     AND trim(p_tipo_marcacao) <> ''
     AND lower(p_tipo_marcacao) NOT IN ('batida', 'b', 'e') THEN
    v_type := CASE v_marc
      WHEN 'S' THEN 'saida'
      WHEN 'P' THEN 'intervalo_saida'
      ELSE 'entrada'
    END;
  ELSE
    v_existing := public.rep_existing_types_operational_journey(p_user_id, p_company_id, p_instant);
    v_interp := public.interpret_punch_by_schedule(p_user_id, p_company_id, p_instant, v_existing);
    v_type := COALESCE(v_interp->>'type', public.rep_journey_type_for_position(COALESCE(array_length(v_existing, 1), 0)));
    v_late := COALESCE((v_interp->>'is_late')::boolean, false);
  END IF;

  resolved_type := replace(replace(lower(trim(v_type)), 'saída', 'saida'), 'pausa', 'intervalo_saida');
  is_late := v_late;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.reclassify_operational_journey_types(
  p_company_id uuid,
  p_user_id uuid,
  p_operational_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_pos int := 0;
  v_updated int := 0;
BEGIN
  PERFORM set_config('ponto.time_record_sequence_reconcile', '1', true);
  PERFORM set_config('ponto.skip_time_record_sequence_check', '1', true);

  FOR r IN
    SELECT tr.id
    FROM public.time_records tr
    WHERE tr.company_id = p_company_id
      AND tr.user_id = p_user_id
      AND public.time_record_operational_date_sp(p_user_id, p_company_id, COALESCE(tr.timestamp, tr.created_at)) = p_operational_date
      AND (COALESCE(tr.source, '') = 'rep' OR COALESCE(tr.method, '') ILIKE 'rep')
    ORDER BY COALESCE(tr.timestamp, tr.created_at), tr.id
  LOOP
    UPDATE public.time_records
    SET type = public.rep_journey_type_for_position(v_pos)
    WHERE id = r.id;
    v_pos := v_pos + 1;
    v_updated := v_updated + 1;
  END LOOP;

  PERFORM set_config('ponto.skip_time_record_sequence_check', '0', true);
  PERFORM set_config('ponto.time_record_sequence_reconcile', '0', true);

  RETURN jsonb_build_object('updated', v_updated, 'operational_date', p_operational_date);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclassify_operational_journey_types(uuid, uuid, date) TO authenticated, service_role;
"""

def extract(sql: str, start: str, end: str) -> str:
    i = sql.find(start)
    j = sql.find(end)
    if i < 0 or j < 0:
        raise SystemExit(f"marker not found: {start!r} -> {end!r}")
    return sql[i:j]

parts = [
    "-- Jornada noturna REP: data operacional + 4 tipos (entrada/intervalo/saída).\n",
    helpers,
    extract(interpret, "CREATE OR REPLACE FUNCTION public.interpret_punch_by_schedule", "COMMENT ON FUNCTION public.interpret_punch_by_schedule"),
    extract(seq, "CREATE OR REPLACE FUNCTION public.time_records_enforce_punch_sequence", "COMMENT ON FUNCTION public.time_records_enforce_punch_sequence"),
    extract(promote, "CREATE OR REPLACE FUNCTION public.rep_promote_pending_rep_punch_logs", "COMMENT ON FUNCTION public.rep_promote_pending_rep_punch_logs"),
    extract(ingest, "CREATE OR REPLACE FUNCTION public.rep_ingest_punch", "COMMENT ON FUNCTION public.rep_ingest_idempotency_precheck"),
]

out = ROOT / "supabase/migrations/20260619180000_rep_night_journey_sequence_operational.sql"
out.write_text("\n".join(parts), encoding="utf-8")
print(f"Wrote {out} ({out.stat().st_size} bytes)")
