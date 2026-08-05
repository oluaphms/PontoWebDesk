/**
 * Classificação central de erros de promoção REP → espelho (sem dispersar includes pelo projeto).
 */

export type RepPromoteErrorType =
  | 'invalid_sequence'
  | 'duplicate_nsr'
  | 'closed_period'
  | 'protected_timesheet'
  | 'missing_user'
  | 'unknown';

const SEQUENCE_MARKERS = ['sequência de ponto inválida', 'Sequência de ponto inválida'] as const;
const CLOSED_MARKERS = ['PERIODO_FECHADO', 'período fechado', 'periodo fechado', 'folha já fechada'] as const;
const PROTECTED_MARKERS = ['portaria 671', 'Portaria 671', 'não permitida', 'imutabilidade'] as const;
const DUPLICATE_MARKERS = ['nsr já importado', 'NSR já importado'] as const;
const MISSING_USER_MARKERS = ['user_not_found', 'sem cadastro', 'não encontrado', 'not found'] as const;

function containsAny(haystack: string, needles: readonly string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

/**
 * Classifica mensagem de erro vinda do Postgres / RPC / cliente.
 */
export function classifyRepPromoteError(error: string | null | undefined): RepPromoteErrorType {
  const msg = (error ?? '').trim();
  if (!msg) return 'unknown';

  if (containsAny(msg, SEQUENCE_MARKERS) || msg.includes('23514')) {
    return 'invalid_sequence';
  }
  if (containsAny(msg, CLOSED_MARKERS)) {
    return 'closed_period';
  }
  if (containsAny(msg, PROTECTED_MARKERS)) {
    return 'protected_timesheet';
  }
  if (containsAny(msg, DUPLICATE_MARKERS) || msg.includes('23505')) {
    return 'duplicate_nsr';
  }
  if (containsAny(msg, MISSING_USER_MARKERS)) {
    return 'missing_user';
  }
  return 'unknown';
}

/**
 * Retry automático imediato no worker: desligado por defeito (intervenção / recálculo / nova batida).
 * `missing_user` pode ser reprocessado após vínculo manual — o chamador trata explicitamente.
 */
export function shouldAllowAutomaticRepPromoteRetry(_code: RepPromoteErrorType): boolean {
  return false;
}
