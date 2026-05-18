import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const srcPath = path.join(root, 'supabase/migrations/20260509120000_rep_promotion_error_tracking.sql');
const outPath = path.join(root, 'supabase/migrations/20260520200000_rep_punch_idempotency_hash.sql');

const src = fs.readFileSync(srcPath, 'utf8');
const start = src.indexOf('CREATE OR REPLACE FUNCTION public.rep_ingest_punch(');
const end = src.indexOf('COMMENT ON FUNCTION public.rep_ingest_punch(', start);
if (start < 0 || end < 0) throw new Error('markers not found');

let fn = src.slice(start, end);

fn = fn.replace(
  'p_trust_client_identity boolean DEFAULT FALSE\n)',
  'p_trust_client_identity boolean DEFAULT FALSE,\n  p_punch_hash text DEFAULT NULL\n)'
);

fn = fn.replace(
  '  v_err_code text;\nBEGIN\n  v_cid := btrim',
  '  v_err_code text;\n  v_precheck jsonb;\n  v_punch_hash text;\nBEGIN\n  v_cid := btrim'
);

fn = fn.replace(
  '  v_company_uuid := v_cid::uuid;\n\n  v_eff := public.rep_effective_valid_pis_11',
  `  v_company_uuid := v_cid::uuid;

  v_precheck := public.rep_ingest_idempotency_precheck(
    p_company_id, p_rep_device_id, p_pis, p_cpf, p_data_hora, p_nsr, p_punch_hash
  );
  IF v_precheck IS NOT NULL THEN
    RETURN v_precheck;
  END IF;

  v_punch_hash := COALESCE(
    NULLIF(btrim(COALESCE(p_punch_hash, '')), ''),
    public.rep_compute_punch_hash(p_rep_device_id, COALESCE(p_pis, p_cpf), p_data_hora, p_nsr)
  );

  v_eff := public.rep_effective_valid_pis_11`
);

fn = fn.replace(
  "RETURN jsonb_build_object('success', false, 'error', 'NSR já importado', 'duplicate', true);",
  "RETURN jsonb_build_object('success', true, 'duplicate', true, 'inserted', false, 'error', 'NSR já importado', 'rep_log_id', v_dup_log_id, 'punch_hash', v_punch_hash);"
);

fn = fn.replace(
  '    data_hora, tipo_marcacao, nsr, origem, source, raw_data, resolved_user_id\n  ) VALUES (',
  '    data_hora, tipo_marcacao, nsr, origem, source, raw_data, resolved_user_id, punch_hash\n  ) VALUES ('
);

fn = fn.replace(
  '    v_raw_out,\n    v_user_id\n  )\n  ON CONFLICT',
  '    v_raw_out,\n    v_user_id,\n    v_punch_hash\n  )\n  ON CONFLICT'
);

fn = fn.replaceAll(
  "RETURN jsonb_build_object(\n      'success', true,",
  "RETURN jsonb_build_object(\n      'success', true,\n      'inserted', true,"
);

fn = fn.replace(
  `    WHERE id = v_log_id;

    RETURN jsonb_build_object(
      'success', true,
      'inserted', true,
      'time_record_id', v_record_id,`,
  `    WHERE id = v_log_id;

    IF p_rep_device_id IS NOT NULL AND v_punch_hash IS NOT NULL THEN
      INSERT INTO public.rep_device_checkpoints (rep_device_id, company_id, last_nsr, last_punch_hash, updated_at)
      VALUES (p_rep_device_id, v_company_uuid, p_nsr, v_punch_hash, NOW())
      ON CONFLICT (rep_device_id) DO UPDATE SET
        last_nsr = EXCLUDED.last_nsr,
        last_punch_hash = EXCLUDED.last_punch_hash,
        updated_at = NOW();
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'inserted', true,
      'time_record_id', v_record_id,`
);

const schemaEnd = `DROP FUNCTION IF EXISTS public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid, boolean
);`;
const header = fs.readFileSync(outPath, 'utf8');
const cut = header.indexOf(schemaEnd);
const schema = header.slice(0, cut);

const footer = `
COMMENT ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid, boolean, text
) IS 'Ingere REP com punch_hash idempotente; duplicata retorna inserted=false.';

GRANT EXECUTE ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid, boolean, text
) TO authenticated, service_role;
`;

fs.writeFileSync(outPath, schema + fn + footer);
console.log('OK', outPath, fs.statSync(outPath).size);
