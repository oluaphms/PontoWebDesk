import { pool } from '../db/index.js';
import { logger } from '../logger/logger.js';

const REP_RPC_FUNCTIONS = new Set([
  'rep_promote_pending_rep_punch_logs',
  'rep_ingest_punch',
  'rep_match_user_id_for_rep_punch_row',
  'rep_ignore_punch_logs',
]);

export function isRepRpcFunction(fn: string): boolean {
  return REP_RPC_FUNCTIONS.has(fn);
}

function optionalUuid(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s.length > 0 ? s : null;
}

function optionalIso(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s.length > 0 ? s : null;
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function asJsonb(value: unknown): string {
  if (value == null) return '{}';
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify({ raw: value });
    }
  }
  return JSON.stringify(value);
}

function asBigIntArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'number' ? v : Number.parseInt(String(v), 10)))
    .filter((n) => Number.isFinite(n));
}

export async function repRpcExistsInDatabase(fn: string): Promise<boolean> {
  const result = await pool.query(
    `select 1
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = $1
      limit 1`,
    [fn],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function executeRepRpcProxy(
  fn: string,
  args: Record<string, unknown>,
  companyId: string,
): Promise<unknown> {
  logger.info({
    module: 'rep.rpc',
    action: 'REP_RPC',
    message: `[REP RPC] ${fn}`,
    companyId,
    meta: { rpcName: fn, rpcPayload: args },
  });

  if (fn === 'rep_promote_pending_rep_punch_logs') {
    const pCompanyId = String(args.p_company_id ?? companyId).trim();
    if (pCompanyId !== companyId) {
      throw new Error('company_id mismatch');
    }
    const result = await pool.query(
      `select public.rep_promote_pending_rep_punch_logs(
         $1::text,
         $2::uuid,
         $3::timestamptz,
         $4::timestamptz,
         $5::uuid,
         $6::uuid
       ) as result`,
      [
        pCompanyId,
        optionalUuid(args.p_rep_device_id),
        optionalIso(args.p_local_window_start),
        optionalIso(args.p_local_window_end),
        optionalUuid(args.p_only_user_id),
        optionalUuid(args.p_only_rep_punch_log_id),
      ],
    );
    return result.rows[0]?.result ?? null;
  }

  if (fn === 'rep_ingest_punch') {
    const pCompanyId = String(args.p_company_id ?? companyId).trim();
    if (pCompanyId !== companyId) {
      throw new Error('company_id mismatch');
    }
    const result = await pool.query(
      `select public.rep_ingest_punch(
         $1::text, $2::uuid, $3::text, $4::text, $5::text, $6::text,
         $7::timestamptz, $8::text, $9::bigint, $10::jsonb,
         $11::boolean, $12::boolean, $13::uuid, $14::boolean, $15::text
       ) as result`,
      [
        pCompanyId,
        optionalUuid(args.p_rep_device_id),
        optionalText(args.p_pis),
        optionalText(args.p_cpf),
        optionalText(args.p_matricula),
        optionalText(args.p_nome_funcionario),
        optionalIso(args.p_data_hora),
        optionalText(args.p_tipo_marcacao),
        args.p_nsr != null ? Number(args.p_nsr) : null,
        asJsonb(args.p_raw_data),
        args.p_only_staging === true,
        args.p_apply_schedule === true,
        optionalUuid(args.p_force_user_id),
        args.p_trust_client_identity === true,
        optionalText(args.p_punch_hash),
      ],
    );
    return result.rows[0]?.result ?? null;
  }

  if (fn === 'rep_match_user_id_for_rep_punch_row') {
    const pCompanyId = String(args.p_company_id ?? companyId).trim();
    if (pCompanyId !== companyId) {
      throw new Error('company_id mismatch');
    }
    const result = await pool.query(
      `select public.rep_match_user_id_for_rep_punch_row(
         $1::text, $2::text, $3::text, $4::text, $5::jsonb
       ) as result`,
      [
        pCompanyId,
        optionalText(args.p_pis),
        optionalText(args.p_cpf),
        optionalText(args.p_matricula),
        asJsonb(args.p_raw_data),
      ],
    );
    return result.rows[0]?.result ?? null;
  }

  if (fn === 'rep_ignore_punch_logs') {
    const pCompanyId = String(args.p_company_id ?? companyId).trim();
    if (pCompanyId !== companyId) {
      throw new Error('company_id mismatch');
    }
    const result = await pool.query(
      `select public.rep_ignore_punch_logs($1::text, $2::bigint[], $3::uuid) as result`,
      [pCompanyId, asBigIntArray(args.p_nsr_list), optionalUuid(args.p_ignored_by)],
    );
    return result.rows[0]?.result ?? null;
  }

  throw new Error(`rep_rpc_unsupported:${fn}`);
}
