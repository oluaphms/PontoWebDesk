
import { AuditLog, LogSeverity } from '../types';

/**
 * LoggingService: Centralizador de monitoramento operacional e segurança.
 * Em produção, estes logs seriam enviados para Stackdriver, Datadog ou Sentry.
 */
type AlertListener = (log: AuditLog) => void;
const listeners = new Set<AlertListener>();

export const LoggingService = {
  
  subscribe(listener: AlertListener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  async log(entry: Omit<AuditLog, 'id' | 'timestamp' | 'ipAddress' | 'userAgent'>) {
    const logEntry: AuditLog = {
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date(),
      ipAddress: '189.121.22.45', // Mocked IP
      userAgent: navigator.userAgent
    };

    // Persistência em cache local imitando banco de logs
    const existing = JSON.parse(localStorage.getItem('smartponto_audit_logs') || '[]');
    const updated = [logEntry, ...existing].slice(0, 1000); // Mantém últimos 1000 logs
    localStorage.setItem('smartponto_audit_logs', JSON.stringify(updated));

    // Console logging para desenvolvimento
    const colors = {
      [LogSeverity.INFO]: 'color: #6366f1',
      [LogSeverity.WARN]: 'color: #f59e0b',
      [LogSeverity.ERROR]: 'color: #ef4444; font-weight: bold',
      [LogSeverity.SECURITY]: 'color: #ffffff; background: #ef4444; padding: 2px 5px; border-radius: 4px'
    };
    
    console.log(`%c[${logEntry.severity.toUpperCase()}] ${logEntry.action}`, colors[logEntry.severity], logEntry.details);

    // Alertas Críticos em tempo real
    if (logEntry.severity === LogSeverity.SECURITY || logEntry.severity === LogSeverity.ERROR) {
      this.triggerAlert(logEntry);
    }
  },

  async getLogs(companyId: string): Promise<AuditLog[]> {
    const stored = localStorage.getItem('smartponto_audit_logs');
    if (!stored) return [];
    const logs = JSON.parse(stored).map((l: any) => ({ ...l, timestamp: new Date(l.timestamp) }));
    return logs.filter((l: AuditLog) => l.companyId === companyId);
  },

  triggerAlert(log: AuditLog) {
    listeners.forEach(listener => listener(log));
    // Em um sistema real, isso enviaria um Webhook para Slack/Discord ou Email
    console.warn(`CRITICAL ALERT: ${log.action} - ${JSON.stringify(log.details)}`);
  }
};
