import { observabilityConsole } from '../../src/shared/logger/observabilityConsole.js';
/**
 * Logs e respostas degradadas para APIs REP (Vercel serverless).
 */

import { noCache } from './cache.js';

export function logRepApi(
  level: 'info' | 'warn' | 'error',
  route: string,
  fields: Record<string, unknown>,
): void {
  const payload = { route, ...fields, ts: new Date().toISOString() };
  if (level === 'error') observabilityConsole.error('[REP API]', payload);
  else if (level === 'warn') observabilityConsole.warn('[REP API]', payload);
  else observabilityConsole.log('[REP API]', payload);
}

export function emptyCommandsResponse(headers: Record<string, string>, reason?: string): Response {
  if (reason) logRepApi('warn', '/api/rep/commands', { degraded: true, reason });
  return noCache(
    Response.json(
      {
        commands: [],
        success: true,
        ok: true,
        degraded: Boolean(reason),
        ...(reason ? { reason } : {}),
      },
      { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } },
    ),
  );
}

export function isSupabaseQuotaOrUnavailableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('exceed_egress_quota') ||
    m.includes('egress') ||
    m.includes('resource exhausted') ||
    m.includes('connection') ||
    m.includes('timeout') ||
    m.includes('503') ||
    m.includes('502')
  );
}
