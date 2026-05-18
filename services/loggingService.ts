import { AuditLog, LogSeverity } from '../types';
import { isSupabaseConfigured, db } from './supabaseClient';

type AlertListener = (log: AuditLog) => void;
const listeners = new Set<AlertListener>();

const STORAGE_KEY = 'smartponto_audit_logs';
const MAX_LOCAL = 1000;

/** SECURITY na auditoria, mas sem alerta em tempo real nem `CRITICAL ALERT` no console (ruído em dev). */
const SECURITY_AUDIT_WITHOUT_RUNTIME_ALERT = new Set<string>(['TIMESHEET_CLOSE', 'TIMESHEET_REOPEN']);

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
          severity: logEntry.severity,
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
        console.error('Audit log Supabase failed:', e);
        this.persistLocal(logEntry);
      }
    } else {
      this.persistLocal(logEntry);
    }

    const colors: Record<string, string> = {
      [LogSeverity.INFO]: 'color: #6366f1',
      [LogSeverity.WARN]: 'color: #f59e0b',
      [LogSeverity.ERROR]: 'color: #ef4444; font-weight: bold',
      [LogSeverity.SECURITY]: 'color: #fff; background: #ef4444; padding: 2px 5px; border-radius: 4px',
    };
    if (typeof console !== 'undefined' && console.log) {
      console.log(
        `%c[${logEntry.severity.toUpperCase()}] ${logEntry.action}`,
        colors[logEntry.severity] ?? '',
        logEntry.details
      );
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
      console.warn('[loggingService] Falha ao persistir log local:', err);
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
          severity: r.severity,
          action: r.action,
          userId: r.user_id,
          userName: r.user_name,
          companyId: r.company_id,
          details: r.details ?? {},
          ipAddress: r.ip_address ?? '',
          userAgent: r.user_agent ?? '',
        }));
      } catch (e) {
        console.error('Audit getLogs Supabase failed:', e);
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
    listeners.forEach((l) => l(log));
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(`CRITICAL ALERT: ${log.action}`, log.details);
    }
  },
};
