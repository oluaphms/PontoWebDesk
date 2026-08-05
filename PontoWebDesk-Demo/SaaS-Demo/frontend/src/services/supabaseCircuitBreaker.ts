let supabaseDown = false;
let lastFailureTime = 0;

const CIRCUIT_BREAKER_COOLDOWN_MS = 10000;
const isDevEnv =
  (typeof import.meta !== 'undefined' && import.meta.env?.DEV) ||
  (typeof window !== 'undefined' && ((window as any).ENV?.ENVIRONMENT === 'dev'));

function errorText(error: unknown): string {
  const e = error as any;
  return String(
    e?.message || e?.details || e?.hint || e?.error?.message || e?.cause?.message || '',
  ).toLowerCase();
}

/** DNS real (Chrome/Chromium usa net::ERR_NAME_NOT_RESOLVED; Node pode usar ENOTFOUND / getaddrinfo). */
export function isDnsError(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes('err_name_not_resolved') ||
    text.includes('name_not_resolved') ||
    text.includes('net::err_name_not_resolved') ||
    text.includes('enotfound') ||
    text.includes('getaddrinfo')
  );
}

export function canRetrySupabase(now: number = Date.now()): boolean {
  if (isDevEnv) {
    return true;
  }
  if (supabaseDown && now - lastFailureTime < CIRCUIT_BREAKER_COOLDOWN_MS) {
    return false;
  }
  supabaseDown = false;
  return true;
}

export function markSupabaseAsDown(now: number = Date.now()): void {
  if (isDevEnv) return;
  supabaseDown = true;
  lastFailureTime = now;
}

export function getCircuitBreakerCooldownMs(): number {
  return CIRCUIT_BREAKER_COOLDOWN_MS;
}

