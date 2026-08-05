/**
 * Redirecionamento para tela de licença bloqueada (Master control plane).
 */
export const LICENSE_BLOCKED_PATH = '/license-blocked';
export const COMMERCIAL_BLOCKED_CODE = 'COMMERCIAL_BLOCKED_BY_MASTER';
const REASON_KEY = 'pwd_commercial_block_reason';

export function isCommercialBlockedCode(code: string | null | undefined): boolean {
  const c = String(code || '').trim();
  return c === COMMERCIAL_BLOCKED_CODE || c === 'commercial_blocked';
}

export function rememberCommercialBlockReason(reason?: string | null): void {
  try {
    sessionStorage.setItem(REASON_KEY, String(reason || '').trim());
  } catch {
    /* ignore */
  }
}

export function readCommercialBlockReason(): string {
  try {
    return String(sessionStorage.getItem(REASON_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function clearCommercialBlockReason(): void {
  try {
    sessionStorage.removeItem(REASON_KEY);
  } catch {
    /* ignore */
  }
}

/** Limpa marcadores locais e navega para a tela de bloqueio comercial. */
export function redirectToLicenseBlocked(reason?: string | null): void {
  rememberCommercialBlockReason(reason);
  if (typeof window === 'undefined') return;
  if (window.location.pathname === LICENSE_BLOCKED_PATH) return;
  window.location.assign(LICENSE_BLOCKED_PATH);
}
