import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Medições explícitas de latência Supabase no pipeline de auth (diagnóstico de “auth rápida, pós-auth lento”).
 */
import { opLog } from '../utils/operationalLogger';

const STEP_CRITICAL_MS = 1500;

export function logSupabaseAuthLatency(
  phase: string,
  durationMs: number,
  extra?: Record<string, unknown>,
): void {
  opLog.info('SUPABASE AUTH LATENCY', { phase, durationMs, ...extra });
  if (durationMs > STEP_CRITICAL_MS) {
    observabilityConsole.warn('[AUTH CRITICAL SLOW]', { phase, durationMs, thresholdMs: STEP_CRITICAL_MS, ...extra });
  }
}

export async function measureSupabaseAsync<T>(
  phase: string,
  fn: () => Promise<T>,
  extra?: Record<string, unknown>,
): Promise<T> {
  if (typeof performance === 'undefined') return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    logSupabaseAuthLatency(phase, Math.round(performance.now() - t0), extra);
  }
}
