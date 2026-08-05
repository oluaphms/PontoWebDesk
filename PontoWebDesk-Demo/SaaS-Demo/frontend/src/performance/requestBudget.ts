import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { beginPostLoginQueryCooldown } from '../app/postLoginQueryGate';
import { devVerboseInfo } from '@/utils/devVerboseLogs';

/**
 * Janela pós-login: instrumentar excesso de trabalho crítico na rede (descoberta, não hard-stop).
 */
const WINDOW_MS = 12_000;
const MAX_CRITICAL = 5;

let windowEndAt = 0;
let criticalCount = 0;
let lastBeginAt = 0;

export function beginPostLoginRequestBudgetWindow(reason: string): void {
  beginPostLoginQueryCooldown(reason);
  const now = Date.now();
  if (now - lastBeginAt < 1500) return;
  lastBeginAt = now;
  windowEndAt = now + WINDOW_MS;
  criticalCount = 0;
  devVerboseInfo('[REQUEST BUDGET]', { phase: 'begin', reason, windowMs: WINDOW_MS, maxCritical: MAX_CRITICAL });
}

export function recordCriticalRequest(tag: string): void {
  if (Date.now() > windowEndAt) return;
  criticalCount += 1;
  if (criticalCount > MAX_CRITICAL && typeof console !== 'undefined') {
    observabilityConsole.warn('[REQUEST BUDGET VIOLATION]', {
      tag,
      criticalCount,
      max: MAX_CRITICAL,
      windowMs: WINDOW_MS,
    });
  }
}

export function isWithinPostLoginBudgetWindow(): boolean {
  return Date.now() <= windowEndAt && windowEndAt > 0;
}
