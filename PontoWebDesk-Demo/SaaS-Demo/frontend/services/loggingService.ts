import { AuditLog, LogSeverity } from '../types';
import { isSupabaseConfigured, db } from './supabaseClient';
import { logger } from '../src/shared/logger/logger';

type AlertListener = (log: AuditLog) => void;
const listeners = new Set<AlertListener>();

const STORAGE_KEY = 'smartponto_audit_logs';
const MAX_LOCAL = 1000;
const AUDIT_CONSOLE_VERBOSE = Boolean(import.meta.env?.DEV) && String(import.meta.env?.VITE_AUDIT_CONSOLE || '') === 'true';

function toAuditDbSeverity(severity: LogSeverity): 'info' | 'warning' | 'error' {
  if (severity === LogSeverity.ERROR) return 'error';
  if (severity === LogSeverity.WARN || severity === LogSeverity.SECURITY) return 'warning';
  return 'info';
}

function fromAuditDbSeverity(raw: unknown): LogSeverity {
  const normalized = String(raw ?? '').trim().toLowerCase();
  if (normalized === 'error') return LogSeverity.ERROR;
  if (normalized === 'warning' || normalized === 'warn') return LogSeverity.WARN;
  if (normalized === 'security') return LogSeverity.SECURITY;
  return LogSeverity.INFO;
}

/** SECURITY na auditoria, mas sem alerta em tempo real nem `CRITICAL ALERT` no console (ruído em dev). */
const SECURITY_AUDIT_WITHOUT_RUNTIME_ALERT = new Set<string>([
  'TIMESHEET_CLOSE',
  'TIMESHEET_REOPEN',
  'ADMIN_ADD_TIME_RECORD',
]);

/** UUID em formato lexical (PostgreSQL uuid); não valida checksum de variant. */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertAuditLogsUuid(id: string, context = 'audit_logs'): void {
  const s = String(id || '').trim();
  if (!UUID_REGEX.test(s)) {
    throw new Error(`${context}: id inválido (esperado formato UUID)`);
  }
}

export const LoggingService = {
  subscribe(listener: AlertListener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  async log(
    entry: Omit<AuditLog, 'id' | 'timestamp' | 'ipAddress' | 'userAgent'> & {
      entity?: string | null;
      entityId?: string | null;
    },
  ) {
    const logEntry: AuditLog = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date(),
      ipAddress: typeof navigator !== 'undefined' ? '0.0.0.0' : '0.0.0.0',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    };

    if (isSupabaseConfigured()) {
      try {
        assertAuditLogsUuid(logEntry.id);
        const tsIso = logEntry.timestamp.toISOString();
        await db.insert('audit_logs', {
          id: logEntry.id,
          timestamp: tsIso,
          created_at: tsIso,
          severity: toAuditDbSeverity(logEntry.severity),
          action: logEntry.action,
          user_id: logEntry.userId ?? null,
          user_name: logEntry.userName ?? null,
          company_id: logEntry.companyId,
          entity: entry.entity ?? null,
          entity_id: entry.entityId ?? null,
          details: logEntry.details ?? {},
          metadata: logEntry.details ?? {},
          ip_address: logEntry.ipAddress,
          user_agent: logEntry.userAgent,
        });
      } catch (e) {
        logger.error({
          module: 'audit.logging-service',
          action: 'AUDIT_SUPABASE_WRITE_FAILED',
          message: 'Falha ao gravar log de auditoria no Supabase',
          error: e,
        });
        this.persistLocal(logEntry);
      }
    } else {
      this.persistLocal(logEntry);
    }

    if (AUDIT_CONSOLE_VERBOSE) {
      logger.info({
        module: 'audit.logging-service',
        action: 'AUDIT_VERBOSE_EVENT',
        message: logEntry.action,
        userId: logEntry.userId ?? null,
        companyId: logEntry.companyId ?? null,
        meta: {
          severity: logEntry.severity,
          details: logEntry.details ?? {},
        },
      });
    }

    const securityNeedsAlert =
      logEntry.severity === LogSeverity.SECURITY &&
      !SECURITY_AUDIT_WITHOUT_RUNTIME_ALERT.has(String(logEntry.action || ''));
    if (logEntry.severity === LogSeverity.ERROR || securityNeedsAlert) {
      this.triggerAlert(logEntry);
    }
  },

  persistLocal(logEntry: AuditLog) {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      const existing = raw ? JSON.parse(raw) : [];
      const updated = [logEntry, ...existing].slice(0, MAX_LOCAL);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      }
    } catch (err) {
      logger.warn({
        module: 'audit.logging-service',
        action: 'AUDIT_LOCAL_PERSIST_FAILED',
        message: 'Falha ao persistir log local',
        error: err,
      });
    }
  },

  async getLogs(companyId: string): Promise<AuditLog[]> {
    if (isSupabaseConfigured()) {
      try {
        const rows = await db.select(
          'audit_logs',
          [{ column: 'company_id', operator: 'eq', value: companyId }],
          { column: 'timestamp', ascending: false },
          500
        );
        return (rows ?? []).map((r: any) => ({
          id: r.id,
          timestamp: new Date(r.timestamp),
          severity: fromAuditDbSeverity(r.severity),
          action: r.action,
          userId: r.user_id,
          userName: r.user_name,
          companyId: r.company_id,
          details: r.details ?? {},
          ipAddress: r.ip_address ?? '',
          userAgent: r.user_agent ?? '',
        }));
      } catch (e) {
        logger.error({
          module: 'audit.logging-service',
          action: 'AUDIT_SUPABASE_READ_FAILED',
          message: 'Falha ao ler logs de auditoria no Supabase',
          error: e,
        });
      }
    }
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      if (!raw) return [];
      const parsed = JSON.parse(raw).map((l: any) => ({ ...l, timestamp: new Date(l.timestamp) }));
      return parsed.filter((l: AuditLog) => l.companyId === companyId);
    } catch {
      return [];
    }
  },

  triggerAlert(log: AuditLog) {
    if (
      log.severity === LogSeverity.SECURITY &&
      SECURITY_AUDIT_WITHOUT_RUNTIME_ALERT.has(String(log.action || ''))
    ) {
      return;
    }
    listeners.forEach((l) => l(log));
    logger.warn({
      module: 'audit.logging-service',
      action: 'AUDIT_CRITICAL_ALERT',
      message: log.action,
      userId: log.userId ?? null,
      companyId: log.companyId ?? null,
      meta: {
        severity: log.severity,
        details: log.details ?? {},
      },
    });
  },
};
