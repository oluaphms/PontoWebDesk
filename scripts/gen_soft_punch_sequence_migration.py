#!/usr/bin/env python3
"""Gera migration de validação flexível de sequência de batidas."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
src = (ROOT / "supabase/migrations/20260619180000_rep_night_journey_sequence_operational.sql").read_text(
    encoding="utf-8"
)
start = src.index("CREATE OR REPLACE FUNCTION public.time_records_enforce_punch_sequence()")
end = src.index("CREATE OR REPLACE FUNCTION public.rep_promote_pending_rep_punch_logs(")
fn = src[start:end]
fn = fn.replace("  v_rep_like boolean;\nBEGIN", "  v_rep_like boolean;\n  v_is_new boolean;\nBEGIN")

replacements = [
    (
        "IF v_t <> 'entrada' THEN\n        RAISE EXCEPTION 'Sequência de ponto inválida: o primeiro registo do dia deve ser entrada.'\n          USING ERRCODE = '23514';\n      END IF;",
        "IF v_t <> 'entrada' AND v_is_new THEN\n        NEW.raw_data := public.annotate_punch_sequence_inconsistency(NEW.raw_data, CASE v_t WHEN 'pausa' THEN 'INTERVAL_WITHOUT_ENTRY' ELSE 'EXIT_WITHOUT_ENTRY' END, CASE v_t WHEN 'pausa' THEN 'Intervalo sem entrada' ELSE 'Saída sem entrada' END);\n      END IF;",
    ),
    (
        "IF v_t = 'entrada' THEN\n        RAISE EXCEPTION 'Sequência de ponto inválida: registe intervalo ou saída antes de uma nova entrada.'\n          USING ERRCODE = '23514';\n      END IF;",
        "IF v_t = 'entrada' AND v_is_new THEN\n        NEW.raw_data := public.annotate_punch_sequence_inconsistency(NEW.raw_data, 'DUPLICATE_ENTRY_WITHOUT_GAP', 'Nova entrada sem intervalo ou saída anterior');\n      END IF;",
    ),
    (
        "IF v_t = 'pausa' THEN\n        RAISE EXCEPTION 'Sequência de ponto inválida: intervalo já iniciado. Finalize o intervalo antes de iniciar outro.'\n          USING ERRCODE = '23514';\n      END IF;",
        "IF v_t = 'pausa' AND v_is_new THEN\n        NEW.raw_data := public.annotate_punch_sequence_inconsistency(NEW.raw_data, 'DUPLICATE_INTERVAL_START', 'Intervalo já iniciado');\n      END IF;",
    ),
    (
        "IF v_t = 'saida' THEN\n        RAISE EXCEPTION 'Sequência de ponto inválida: finalize o intervalo (retorno) antes da saída.'\n          USING ERRCODE = '23514';\n      END IF;",
        "IF v_t = 'saida' AND v_is_new THEN\n        NEW.raw_data := public.annotate_punch_sequence_inconsistency(NEW.raw_data, 'EXIT_WITHOUT_INTERVAL_RETURN', 'Saída sem retorno de intervalo');\n      END IF;",
    ),
    (
        "IF v_t = 'saida' THEN\n        RAISE EXCEPTION 'Sequência de ponto inválida: registe entrada antes de uma nova saída.'\n          USING ERRCODE = '23514';\n      END IF;",
        "IF v_t = 'saida' AND v_is_new THEN\n        NEW.raw_data := public.annotate_punch_sequence_inconsistency(NEW.raw_data, 'EXIT_WITHOUT_NEW_ENTRY', 'Saída sem nova entrada');\n      END IF;",
    ),
    (
        "IF v_t = 'pausa' THEN\n        RAISE EXCEPTION 'Sequência de ponto inválida: registe entrada antes de iniciar intervalo.'\n          USING ERRCODE = '23514';\n      END IF;",
        "IF v_t = 'pausa' AND v_is_new THEN\n        NEW.raw_data := public.annotate_punch_sequence_inconsistency(NEW.raw_data, 'INTERVAL_WITHOUT_NEW_ENTRY', 'Intervalo sem nova entrada');\n      END IF;",
    ),
]

for old, new in replacements:
    if old not in fn:
        raise SystemExit(f"Trecho não encontrado: {old[:60]}...")
    fn = fn.replace(old, new)

fn = fn.replace(
    "    SELECT s.inst, s.typ\n    FROM (",
    "    SELECT s.inst, s.typ, s.is_new\n    FROM (",
)
fn = fn.replace(
    "        tr.id::text AS rid\n      FROM public.time_records tr",
    "        tr.id::text AS rid,\n        false AS is_new\n      FROM public.time_records tr",
)
fn = fn.replace(
    "        COALESCE(NEW.timestamp, NEW.created_at, NOW()),\n        v_t,\n        COALESCE(NEW.id::text, '')",
    "        COALESCE(NEW.timestamp, NEW.created_at, NOW()),\n        v_t,\n        COALESCE(NEW.id::text, ''),\n        true AS is_new",
)
fn = fn.replace(
    "    v_t := r.typ;\n\n    IF v_last IS NULL",
    "    v_t := r.typ;\n    v_is_new := r.is_new;\n\n    IF v_last IS NULL",
)

header = """-- Flexibilização: registrar batida sempre; sinalizar inconsistência em raw_data.

CREATE OR REPLACE FUNCTION public.annotate_punch_sequence_inconsistency(
  p_raw_data jsonb,
  p_code text,
  p_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_raw_data, '{}'::jsonb) || jsonb_build_object(
    'sequence_inconsistency', true,
    'sequence_inconsistency_code', p_code,
    'sequence_inconsistency_message', COALESCE(p_message, p_code)
  );
$$;

"""

out = ROOT / "supabase/migrations/20260620120000_punch_sequence_soft_validate.sql"
out.write_text(
    header
    + fn
    + "\nCOMMENT ON FUNCTION public.time_records_enforce_punch_sequence() IS\n"
    + "  'BEFORE INSERT: não bloqueia sequência inválida; marca raw_data para auditoria.';\n",
    encoding="utf-8",
)
print(f"Wrote {out} ({out.stat().st_size} bytes)")
