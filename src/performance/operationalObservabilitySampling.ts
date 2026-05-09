/**
 * Amostragem adaptativa de observabilidade — reduz volume em produção.
 * CRITICAL: sempre; WARNING: parcial; INFO: amostrado.
 */

export type OpsLogLevel = 'info' | 'warn' | 'error';

let infoSampleRate = 0.12;
let warnSampleRate = 0.55;
let burstInfoSuppressedUntil = 0;

/** Ajuste fino (ex.: telemetria remota). */
export function setOperationalObservabilitySampleRates(info: number, warn: number): void {
  infoSampleRate = Math.min(1, Math.max(0, info));
  warnSampleRate = Math.min(1, Math.max(0, warn));
}

function shouldEmit(level: OpsLogLevel): boolean {
  const now = Date.now();
  if (level === 'error') return true;
  if (now < burstInfoSuppressedUntil && level === 'info') return false;
  const r = Math.random();
  if (level === 'warn') return r < warnSampleRate;
  return r < infoSampleRate;
}

/** Após storm de logs, suprimir INFO brevemente. */
export function suppressOperationalInfoLogging(ms: number): void {
  burstInfoSuppressedUntil = Date.now() + ms;
}

export function operationalObservabilityLog(
  level: OpsLogLevel,
  tag: string,
  payload?: Record<string, unknown>,
): void {
  if (!shouldEmit(level)) return;
  const line = { tag, ...payload };
  if (level === 'error') {
    console.error('[OPS]', line);
  } else if (level === 'warn') {
    console.warn('[OPS]', line);
  } else {
    console.info('[OPS]', line);
  }
}
