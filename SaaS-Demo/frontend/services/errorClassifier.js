/**
 * Classificador de erros para triagem automática da Dead Letter Queue.
 *
 * CATEGORIAS:
 * - VALIDATION_ERROR  → não reprocessar (dado inválido, nunca vai funcionar)
 * - FK_ERROR          → não reprocessar automaticamente (device_id não existe no Supabase)
 * - AUTH_ERROR        → não reprocessar (credencial inválida, requer intervenção)
 * - NETWORK_ERROR     → reprocessar (transitório: timeout, conexão recusada)
 * - RATE_LIMIT        → reprocessar com delay maior
 * - SERVER_ERROR      → reprocessar (5xx do Supabase)
 * - UNKNOWN           → reprocessar (conservador)
 *
 * Uso no nack():
 *   const type = classifyError(errorMessage);
 *   if (!isRetryable(type)) → mover direto para failed sem incrementar attempts
 */

export const ERROR_TYPE = /** @type {const} */ ({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  FK_ERROR:         'FK_ERROR',
  AUTH_ERROR:       'AUTH_ERROR',
  NETWORK_ERROR:    'NETWORK_ERROR',
  RATE_LIMIT:       'RATE_LIMIT',
  SERVER_ERROR:     'SERVER_ERROR',
  CIRCUIT_OPEN:     'CIRCUIT_OPEN',
  UNKNOWN:          'UNKNOWN',
});

/** Padrões de mensagem de erro → categoria. */
const PATTERNS = [
  // Validação / schema
  { type: ERROR_TYPE.VALIDATION_ERROR, patterns: [
    /invalid input syntax/i,
    /violates check constraint/i,
    /value too long/i,
    /invalid.*uuid/i,
    /not-null constraint/i,
    /column.*does not exist/i,
    /relation.*does not exist/i,
    /schema.*does not exist/i,
    /PGRST\d{3}/,           // PostgREST schema errors
    /42\d{3}/,              // PostgreSQL syntax/schema errors (42xxx)
  ]},
  // FK violation
  { type: ERROR_TYPE.FK_ERROR, patterns: [
    /foreign key constraint/i,
    /violates foreign key/i,
    /23503/,
    /fkey/i,
  ]},
  // Auth
  { type: ERROR_TYPE.AUTH_ERROR, patterns: [
    /invalid api key/i,
    /jwt expired/i,
    /jwt invalid/i,
    /unauthorized/i,
    /401/,
    /403/,
    /permission denied/i,
    /insufficient_privilege/i,
  ]},
  // Rate limit
  { type: ERROR_TYPE.RATE_LIMIT, patterns: [
    /rate limit/i,
    /too many requests/i,
    /429/,
  ]},
  // Network / transitório
  { type: ERROR_TYPE.NETWORK_ERROR, patterns: [
    /ECONNREFUSED/,
    /ECONNRESET/,
    /ETIMEDOUT/,
    /ENOTFOUND/,
    /fetch failed/i,
    /network error/i,
    /socket hang up/i,
    /aborted/i,
    /timeout/i,
    /ECONNABORTED/,
  ]},
  // Server error
  { type: ERROR_TYPE.SERVER_ERROR, patterns: [
    /500/,
    /502/,
    /503/,
    /504/,
    /internal server error/i,
    /bad gateway/i,
    /service unavailable/i,
  ]},
  // Circuit breaker
  { type: ERROR_TYPE.CIRCUIT_OPEN, patterns: [
    /circuit breaker open/i,
    /CircuitOpenError/,
  ]},
];

/**
 * Classifica uma mensagem de erro em uma categoria.
 * @param {string} errorMessage
 * @returns {string} ERROR_TYPE
 */
export function classifyError(errorMessage) {
  if (!errorMessage) return ERROR_TYPE.UNKNOWN;
  const msg = String(errorMessage);
  for (const { type, patterns } of PATTERNS) {
    if (patterns.some(p => p.test(msg))) return type;
  }
  return ERROR_TYPE.UNKNOWN;
}

/**
 * Retorna true se o erro é transitório e deve ser reprocessado.
 * @param {string} errorType — ERROR_TYPE
 * @returns {boolean}
 */
export function isRetryable(errorType) {
  return [
    ERROR_TYPE.NETWORK_ERROR,
    ERROR_TYPE.RATE_LIMIT,
    ERROR_TYPE.SERVER_ERROR,
    ERROR_TYPE.CIRCUIT_OPEN,
    ERROR_TYPE.UNKNOWN,
  ].includes(errorType);
}

/**
 * Retorna o delay de retry recomendado para um tipo de erro.
 * Rate limit → delay maior; outros → backoff padrão.
 *
 * @param {string} errorType
 * @param {number} attempts
 * @returns {number} ms
 */
export function retryDelayMs(errorType, attempts) {
  if (errorType === ERROR_TYPE.RATE_LIMIT) {
    // Rate limit: esperar pelo menos 60s
    return Math.max(60_000, Math.min(300_000, 60_000 * Math.pow(2, Math.max(0, attempts - 1))));
  }
  if (errorType === ERROR_TYPE.CIRCUIT_OPEN) {
    // Circuit aberto: não incrementar delay (o CB vai resetar sozinho)
    return 5_000;
  }
  // Backoff padrão: 1s → 2s → 4s → … → 60s
  return Math.min(60_000, 1_000 * Math.pow(2, attempts));
}
