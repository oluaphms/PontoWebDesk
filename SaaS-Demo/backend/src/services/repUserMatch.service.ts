import { pool } from '../db/index.js';
import { logger } from '../logger/logger.js';

type MatchInput = {
  companyId: string;
  employeeId: string | null;
  pis: string | null;
  cpf: string | null;
  matricula: string | null;
  rawData: Record<string, unknown>;
};

type MatchResult = {
  userId: string | null;
  strategy: string;
};

function normalizeDigits(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits || null;
}

async function matchByIdentifier(
  companyId: string,
  identifierType: 'pis' | 'cpf',
  value: string | null,
  matricula: string | null,
  rawData: Record<string, unknown>,
): Promise<string | null> {
  if (!value) return null;
  const result = await pool.query(
    `select public.rep_match_user_id_for_rep_punch_row(
       $1::text, $2::text, $3::text, $4::text, $5::jsonb
     ) as match`,
    [
      companyId,
      identifierType === 'pis' ? value : null,
      identifierType === 'cpf' ? value : null,
      matricula,
      JSON.stringify(rawData),
    ],
  );
  const row = result.rows[0]?.match as { user_id?: string | null } | null;
  const userId = typeof row?.user_id === 'string' ? row.user_id.trim() : '';
  return userId || null;
}

/**
 * Resolve colaborador para batida REP (paridade com repPunchRpcLite no Vercel).
 * Ordem: employee_id forçado → CPF → PIS → matrícula via RPC tiered.
 */
export async function resolveUserForRepPunch(input: MatchInput): Promise<MatchResult> {
  if (input.employeeId) {
    return { userId: input.employeeId, strategy: 'forced_employee_id' };
  }

  const byCpf = await matchByIdentifier(
    input.companyId,
    'cpf',
    input.cpf,
    input.matricula,
    input.rawData,
  );
  if (byCpf) {
    return { userId: byCpf, strategy: 'cpf' };
  }

  const byPis = await matchByIdentifier(
    input.companyId,
    'pis',
    input.pis,
    input.matricula,
    input.rawData,
  );
  if (byPis) {
    return { userId: byPis, strategy: 'pis' };
  }

  logger.warn({
    module: 'rep.user_match',
    action: 'PUNCH_USER_NOT_MATCHED',
    companyId: input.companyId,
    message: 'Colaborador não encontrado para batida REP',
    meta: {
      has_pis: Boolean(normalizeDigits(input.pis)),
      has_cpf: Boolean(normalizeDigits(input.cpf)),
      has_matricula: Boolean(input.matricula),
    },
  });

  return { userId: null, strategy: 'none' };
}
