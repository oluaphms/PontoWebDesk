/**
 * Configuração de expiração / limites da sessão Master.
 * Não afeta JWT_SECRET / sessões das empresas.
 */

function parseDurationMs(raw: string, fallbackMs: number): number {
  const match = String(raw || '')
    .trim()
    .match(/^(\d+)([smhd])$/i);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factor =
    unit === 's'
      ? 1000
      : unit === 'm'
        ? 60 * 1000
        : unit === 'h'
          ? 60 * 60 * 1000
          : 24 * 60 * 60 * 1000;
  return amount * factor;
}

/** TTL do access JWT Master (default 8h). */
export function getMasterAccessTtl(): string {
  return String(process.env.MASTER_JWT_EXPIRES_IN || '8h').trim() || '8h';
}

export function getMasterAccessTtlMs(): number {
  return parseDurationMs(getMasterAccessTtl(), 8 * 60 * 60 * 1000);
}

/** TTL do refresh token Master (default 7d). */
export function getMasterRefreshTtl(): string {
  return String(process.env.MASTER_REFRESH_EXPIRES_IN || '7d').trim() || '7d';
}

export function getMasterRefreshTtlMs(): number {
  return parseDurationMs(getMasterRefreshTtl(), 7 * 24 * 60 * 60 * 1000);
}

/** Máximo de sessões Master simultâneas por usuário (default 5). */
export function getMasterMaxSessions(): number {
  const n = Number(process.env.MASTER_MAX_SESSIONS || 5);
  if (!Number.isFinite(n) || n < 1) return 5;
  return Math.min(Math.floor(n), 50);
}
