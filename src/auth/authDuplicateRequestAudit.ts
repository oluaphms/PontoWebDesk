import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Detecta sobreposição de pedidos idênticos no pipeline de auth (diagnóstico).
 */
import { isDevVerboseLogsEnabled } from '../utils/devVerboseLogs';

type InFlight = { startedAt: number; stack?: string };

const profileInflight = new Map<string, InFlight>();
const sessionInflight = new Map<string, InFlight>();

let pipelineId: number | null = null;
let attemptId: number | null = null;

export function setAuthDuplicateContext(ctx: { pipelineId?: number | null; attemptId?: number | null }): void {
  if (ctx.pipelineId !== undefined) pipelineId = ctx.pipelineId;
  if (ctx.attemptId !== undefined) attemptId = ctx.attemptId;
}

export function clearAuthDuplicateContext(): void {
  pipelineId = null;
  attemptId = null;
}

export function getAuthDuplicateDiagnostics(): { pipelineId: number | null; attemptId: number | null } {
  return { pipelineId, attemptId };
}

function sampleStack(): string | undefined {
  if (typeof Error === 'undefined') return undefined;
  return new Error().stack?.split('\n').slice(2, 8).join('\n');
}

function logDuplicate(kind: string, key: string, prev: InFlight): void {
  if (typeof console === 'undefined') return;
  if (!isDevVerboseLogsEnabled()) return;
  observabilityConsole.warn('[AUTH DUPLICATE REQUEST]', {
    kind,
    key,
    pipelineId,
    attemptId,
    overlapMs: Date.now() - prev.startedAt,
    previousStack: prev.stack,
    currentStack: sampleStack(),
  });
}

export function auditProfileRequestStart(authUserId: string): void {
  const key = authUserId;
  const prev = profileInflight.get(key);
  const now = Date.now();
  if (prev && now - prev.startedAt < 30_000) {
    logDuplicate('profile', key, prev);
  }
  profileInflight.set(key, { startedAt: now, stack: sampleStack() });
}

export function auditProfileRequestEnd(authUserId: string): void {
  profileInflight.delete(authUserId);
}

export function auditSessionRequestStart(label: string): void {
  const key = label;
  const prev = sessionInflight.get(key);
  const now = Date.now();
  if (prev && now - prev.startedAt < 10_000) {
    logDuplicate('session', key, prev);
  }
  sessionInflight.set(key, { startedAt: now, stack: sampleStack() });
}

export function auditSessionRequestEnd(label: string): void {
  sessionInflight.delete(label);
}
