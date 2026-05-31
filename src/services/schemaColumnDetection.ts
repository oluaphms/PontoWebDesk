import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * ⚠️ IMPORTANTE:
 * Em produção, o uso de detecção dinâmica de schema é PROIBIDO.
 * Sempre definir VITE_HAS_AUDIT_LOGS_TENANT_ID.
 *
 * ---
 * Override via `readAuditLogsTenantIdFromEnv()` (Schema Guard).
 * Fallback `hasColumn`/`information_schema` apenas em modo desenvolvimento quando o ENV está indefinido.
 */

import { getSupabaseClientOrThrow } from '@/lib/supabaseClient';
import { IS_PRODUCTION } from '@/config/runtimeEnv';
import { enforceEnvSchemaFlag, getSchemaGuardError } from '@/services/schemaGuard';
import { reportSchemaGuardState, trackSchemaGuardUsage } from '@/services/schemaGuardReporter';

/** Resultado já resolvido (true/false). */
const resolvedBool = new Map<string, boolean>();
/** Promessa em curso (dedupe concorrente). */
const inflight = new Map<string, Promise<boolean>>();

let loggedSchemaAuto = false;

function cacheKey(tableSchema: string, tableName: string, columnName: string): string {
  return `${tableSchema}:${tableName}:${columnName}`;
}

/** Cache key público para `clearSchemaColumnCache` parcial (`public:audit_logs:tenant_id`). */
export const AUDIT_LOGS_TENANT_ID_CACHE_KEY = cacheKey('public', 'audit_logs', 'tenant_id');

export function readAuditLogsTenantIdFromEnv(): boolean | undefined {
  const raw = import.meta.env.VITE_HAS_AUDIT_LOGS_TENANT_ID;
  return enforceEnvSchemaFlag(raw, 'VITE_HAS_AUDIT_LOGS_TENANT_ID');
}

export async function hasColumn(tableName: string, columnName: string, tableSchema = 'public'): Promise<boolean> {
  const tn = String(tableName || '').trim();
  const cn = String(columnName || '').trim();
  const ts = String(tableSchema || 'public').trim() || 'public';
  if (!tn || !cn) return false;

  const key = cacheKey(ts, tn, cn);
  if (resolvedBool.has(key)) return resolvedBool.get(key)!;
  let p = inflight.get(key);
  if (!p) {
    p = probeColumnExists(ts, tn, cn)
      .then((exists) => {
        resolvedBool.set(key, exists);
        inflight.delete(key);
        return exists;
      })
      .catch(() => {
        void trackSchemaGuardUsage('hasColumn:fallback');
        resolvedBool.set(key, false);
        inflight.delete(key);
        return false;
      });
    inflight.set(key, p);
  }
  return p;
}

async function probeColumnExists(tableSchema: string, tableName: string, columnName: string): Promise<boolean> {
  const client = getSupabaseClientOrThrow();
  const res = await client
    .schema('information_schema')
    .from('columns')
    .select('column_name')
    .eq('table_schema', tableSchema)
    .eq('table_name', tableName)
    .eq('column_name', columnName)
    .limit(1)
    .maybeSingle();

  if (res.error) {
    throw new Error(res.error.message || String(res.error));
  }

  const row = res.data as { column_name?: string } | null;
  return !!(row && row.column_name);
}

export function clearSchemaColumnCache(key?: string): void {
  if (key === undefined || key === '*') {
    resolvedBool.clear();
    inflight.clear();
    warnedAuditLogsNoTenantId = false;
    loggedSchemaAuto = false;
    return;
  }
  resolvedBool.delete(key);
  inflight.delete(key);
  if (key === AUDIT_LOGS_TENANT_ID_CACHE_KEY) {
    warnedAuditLogsNoTenantId = false;
    loggedSchemaAuto = false;
  }
}

let warnedAuditLogsNoTenantId = false;

const AUDIT_LOGS_SELECT_PREFIX =
  'id, timestamp, created_at, severity, action, user_id, user_name, company_id, details, ip_address, user_agent';
const AUDIT_LOGS_SELECT_SUFFIX =
  'old_data, new_data, ip, entity, "table", "before", "after"';

function auditLogsProjection(hasTenantId: boolean): string {
  return hasTenantId
    ? `${AUDIT_LOGS_SELECT_PREFIX}, tenant_id, ${AUDIT_LOGS_SELECT_SUFFIX}`
    : `${AUDIT_LOGS_SELECT_PREFIX}, ${AUDIT_LOGS_SELECT_SUFFIX}`;
}

export async function getAuditLogsSelectColumns(): Promise<string> {
  const envOverride = readAuditLogsTenantIdFromEnv();

  if (envOverride !== undefined) {
    return auditLogsProjection(envOverride);
  }

  if (IS_PRODUCTION) {
    const current = getSchemaGuardError();
    observabilityConsole.error('[SCHEMA GUARD FAIL-SAFE ACTIVATED]');
    void reportSchemaGuardState({
      mode: 'production-error',
      env: 'VITE_HAS_AUDIT_LOGS_TENANT_ID',
      origin: 'getAuditLogsSelectColumns',
      message: '[SCHEMA GUARD FAIL-SAFE ACTIVATED]',
      correlation_id: current?.correlation_id,
    });
    observabilityConsole.error(
      '[SCHEMA GUARD] FALHA CRÍTICA: caminho automático de schema bloqueado em produção — assumindo audit_logs sem tenant_id',
    );
    return auditLogsProjection(false);
  }

  void trackSchemaGuardUsage('getAuditLogsSelectColumns:fallback');
  const hasTid = await hasColumn('audit_logs', 'tenant_id');
  if (!loggedSchemaAuto) {
    loggedSchemaAuto = true;
    observabilityConsole.log('[SCHEMA AUTO] tenant_id detectado automaticamente');
  }
  if (!hasTid && !warnedAuditLogsNoTenantId) {
    warnedAuditLogsNoTenantId = true;
    observabilityConsole.warn('[SCHEMA WARNING] audit_logs sem tenant_id — usando fallback');
  }
  return auditLogsProjection(hasTid);
}
