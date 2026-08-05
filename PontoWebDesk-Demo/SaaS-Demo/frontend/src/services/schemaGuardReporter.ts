import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { IS_PRODUCTION, getEnvBoolean } from '@/config/runtimeEnv';
import type { SchemaGuardErrorState } from '@/services/schemaGuard';
import { getSessionTenantScope } from '@/auth/sessionAccess';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LogSeverity } from '../../types';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SchemaGuardReportState = {
  mode: SchemaGuardErrorState['mode'];
  env: string;
  timestamp?: string;
  origin: string;
  message?: string;
  correlation_id?: string;
  session_id?: string;
  app_version?: string;
};

const REPORT_THROTTLE_MS = 10_000;
const throttleByKey = new Map<string, number>();
let lastCorrelationId: string | null = null;
let lastCorrelationAt = 0;

export function safeJsonStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return '[unserializable]';
  }
}

function readWindowSchemaGuardState(): SchemaGuardErrorState | null {
  if (typeof window === 'undefined') return null;
  return (window as any).__SCHEMA_GUARD_ERROR__ || null;
}

function resolveCompanyId(): string | null {
  if (typeof window === 'undefined') return null;
  const companyId = String(getSessionTenantScope().companyId || '').trim();
  return companyId && companyId !== 'no-company' ? companyId : null;
}

function resolveSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  if (!w.__SCHEMA_SESSION_ID__) {
    w.__SCHEMA_SESSION_ID__ = crypto.randomUUID();
  }
  return w.__SCHEMA_SESSION_ID__ ?? null;
}

function buildDetails(state: SchemaGuardReportState, timestamp: string): Record<string, unknown> {
  return {
    schema_guard: true,
    mode: state.mode,
    env: state.env,
    origin: state.origin,
    message: state.message,
    timestamp,
    correlation_id: state.correlation_id,
    session_id: state.session_id,
    app_version: state.app_version,
  };
}

function shouldThrottle(mode: SchemaGuardReportState['mode']): boolean {
  const key = `SCHEMA_GUARD_EVENT:${mode}`;
  const now = Date.now();
  const last = throttleByKey.get(key);
  if (last && now - last < REPORT_THROTTLE_MS) {
    return true;
  }
  throttleByKey.set(key, now);
  return false;
}

async function insertAuditLog(state: SchemaGuardReportState): Promise<void> {
  if (!isSupabaseConfigured()) return;
  if (shouldThrottle(state.mode)) return;
  const companyId = resolveCompanyId();
  if (!companyId) {
    observabilityConsole.warn('[SCHEMA GUARD] auditoria ignorada por falta de company_id');
    return;
  }

  const id = crypto.randomUUID();
  if (!UUID_REGEX.test(id)) {
    observabilityConsole.error('[SCHEMA GUARD REPORT] UUID inválido; auditoria ignorada');
    return;
  }

  const timestamp = state.timestamp ?? new Date().toISOString();
  const detailsRaw = buildDetails(state, timestamp);
  const detailsSerialized = safeJsonStringify(detailsRaw);
  const details =
    detailsSerialized === '[unserializable]' ? { error: detailsSerialized } : detailsRaw;

  const severity = state.mode === 'production-error' ? LogSeverity.ERROR : LogSeverity.WARN;

  try {
    await db.insert('audit_logs', {
      id,
      timestamp,
      created_at: timestamp,
      severity,
      action: 'SCHEMA_GUARD_EVENT',
      user_id: null,
      user_name: null,
      company_id: companyId,
      details,
      ip_address: '0.0.0.0',
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });
  } catch (error) {
    observabilityConsole.error('[SCHEMA GUARD REPORT] falha ao gravar auditoria', error);
  }
}

export async function reportSchemaGuardState(state: SchemaGuardReportState): Promise<void> {
  const timestamp = state.timestamp ?? new Date().toISOString();
  const appVersion = import.meta.env.VITE_APP_VERSION || 'dev';
  const sessionId = resolveSessionId();
  const payload = {
    ...state,
    timestamp,
    app_version: state.app_version ?? appVersion,
    session_id: state.session_id ?? sessionId ?? undefined,
  };

  if (
    payload.correlation_id &&
    lastCorrelationId &&
    payload.correlation_id !== lastCorrelationId &&
    Date.now() - lastCorrelationAt < 5000
  ) {
    observabilityConsole.error('[SCHEMA GUARD WARNING] múltiplos eventos críticos em sequência');
  }
  if (payload.correlation_id && payload.correlation_id !== lastCorrelationId) {
    lastCorrelationId = payload.correlation_id;
    lastCorrelationAt = Date.now();
  }

  if (!IS_PRODUCTION) {
    observabilityConsole.warn('[SCHEMA GUARD REPORT]', safeJsonStringify(payload));
  } else if (state.mode === 'production-error') {
    observabilityConsole.error('[SCHEMA GUARD REPORT]', safeJsonStringify(payload));
  }

  if (IS_PRODUCTION) {
    await insertAuditLog(payload);
  }
}

export async function trackSchemaGuardUsage(origin: string): Promise<void> {
  const current = readWindowSchemaGuardState();
  if (!current) return;
  await reportSchemaGuardState({
    mode: current.mode,
    env: current.env,
    timestamp: current.timestamp,
    message: current.message,
    correlation_id: current.correlation_id,
    origin,
  });
}

export function runSchemaGuardSelfTest(): boolean {
  const envRaw = import.meta.env.VITE_HAS_AUDIT_LOGS_TENANT_ID;
  const envParsed = getEnvBoolean(envRaw);
  const debugAvailable =
    typeof window !== 'undefined' && !!(window as any).__SCHEMA_GUARD_DEBUG__;
  const state = readWindowSchemaGuardState();
  const resetOk = (() => {
    if (!debugAvailable) return false;
    try {
      (window as any).__SCHEMA_GUARD_DEBUG__?.resetAll?.();
      return !(window as any).__SCHEMA_GUARD_ERROR__;
    } catch {
      return false;
    }
  })();
  const fallbackOk = envParsed !== undefined ? true : !!state;
  const throttleActive = (() => {
    const key = `SCHEMA_GUARD_EVENT:dev-warning`;
    throttleByKey.set(key, Date.now());
    return shouldThrottle('dev-warning');
  })();
  const reporterActive = typeof reportSchemaGuardState === 'function';
  const ok = debugAvailable && resetOk && fallbackOk && reporterActive && throttleActive;

  if (!IS_PRODUCTION) {
    if (ok) {
      observabilityConsole.info('[SCHEMA GUARD SELF TEST OK]');
    } else {
      observabilityConsole.error('[SCHEMA GUARD SELF TEST FAILED]', {
        debugAvailable,
        resetOk,
        envParsed,
        fallbackOk,
        reporterActive,
        throttleActive,
        state,
      });
    }
  } else if (!ok) {
    observabilityConsole.error('[SCHEMA GUARD SELF TEST FAILED]', {
      debugAvailable,
      resetOk,
      envParsed,
      fallbackOk,
      reporterActive,
      throttleActive,
      state,
    });
  }

  return ok;
}
