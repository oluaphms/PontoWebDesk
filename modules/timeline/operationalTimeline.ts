/**
 * Eventos unificados para a timeline operacional (extrato por colaborador/dia).
 */

import { normalizeRecordTypeForMirror } from '../../src/utils/timesheetMirror';

export type TimelineEventType = 'punch' | 'rep_pending' | 'alert' | 'task' | 'audit';

export type TimelineEvent = {
  id: string;
  type: TimelineEventType;
  /** ISO 8601 — ordenação cronológica */
  timestamp: string;
  title: string;
  description: string | null;
  severity: string | null;
  metadata: Record<string, unknown>;
};

const PUNCH_TITLE: Record<string, string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  intervalo_saida: 'Início de intervalo',
  intervalo_volta: 'Fim de intervalo',
};

export function punchTitleFromType(rawType: string): string {
  const n = normalizeRecordTypeForMirror(rawType);
  return PUNCH_TITLE[n] ?? rawType ?? 'Batida';
}

export function alertTypeTitle(alertType: string): string {
  const labels: Record<string, string> = {
    missing_exit: 'Alerta: sem saída',
    long_break: 'Alerta: intervalo longo',
    excess_hours: 'Alerta: jornada excessiva',
    inconsistency: 'Alerta: inconsistência',
    rep_pending_stale: 'Alerta: REP pendente',
  };
  return labels[alertType] ?? `Alerta: ${alertType}`;
}

export function taskTypeTitle(taskType: string): string {
  const labels: Record<string, string> = {
    missing_exit: 'Tarefa: sem saída',
    long_break: 'Tarefa: pausa longa',
    rep_pending: 'Tarefa: REP pendente',
    inconsistency: 'Tarefa: inconsistência',
    excess_hours: 'Tarefa: jornada excessiva',
  };
  return labels[taskType] ?? `Tarefa: ${taskType}`;
}

export function auditTimelineTitle(entityType: string, action: string): string {
  const et = entityType === 'task' ? 'Tarefa' : entityType === 'alert' ? 'Alerta' : entityType;
  if (action === 'resolved') return `${et} resolvida/o`;
  if (action === 'created') return `${et} criada/o`;
  if (action === 'updated') return `${et} atualizada/o`;
  return `${et}: ${action}`;
}

type TimeRecordRow = {
  id: string;
  type?: string | null;
  timestamp?: string | null;
  created_at?: string | null;
};

type RepPendingRow = {
  id: string;
  data_hora: string;
  tipo_marcacao?: string | null;
};

type AlertRow = {
  id: string;
  alert_type: string;
  message: string;
  severity: string;
  resolved?: boolean;
  created_at?: string | null;
  resolved_at?: string | null;
};

type TaskRow = {
  id: string;
  task_type: string;
  title?: string | null;
  description?: string | null;
  priority: string;
  status: string;
  related_alert_id?: string | null;
  created_at?: string | null;
  resolved_at?: string | null;
};

type AuditRow = {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

function instantOrCreated(ts: string | null | undefined, fallback: string | null | undefined): string {
  const a = ts && String(ts).trim() ? String(ts) : '';
  const b = fallback && String(fallback).trim() ? String(fallback) : '';
  return a || b || new Date().toISOString();
}

export function eventFromPunch(row: TimeRecordRow): TimelineEvent {
  const timestamp = instantOrCreated(row.timestamp, row.created_at);
  const rawType = String(row.type ?? '');
  return {
    id: `punch:${row.id}`,
    type: 'punch',
    timestamp,
    title: punchTitleFromType(rawType),
    description: rawType || null,
    severity: null,
    metadata: { record_type: rawType, source: 'time_records' },
  };
}

export function eventFromRepPending(row: RepPendingRow): TimelineEvent {
  const tipo = String(row.tipo_marcacao ?? '').trim();
  return {
    id: `rep_pending:${row.id}`,
    type: 'rep_pending',
    timestamp: row.data_hora,
    title: tipo ? `REP pendente (${tipo})` : 'REP pendente',
    description: 'Batida no relógio ainda não consolidada no espelho',
    severity: 'medium',
    metadata: { tipo_marcacao: tipo || null, source: 'rep_punch_logs' },
  };
}

export function eventFromAlert(row: AlertRow): TimelineEvent {
  const ts = row.created_at ? String(row.created_at) : new Date().toISOString();
  return {
    id: `alert:${row.id}`,
    type: 'alert',
    timestamp: ts,
    title: alertTypeTitle(row.alert_type),
    description: row.message,
    severity: row.severity,
    metadata: {
      alert_type: row.alert_type,
      resolved: row.resolved ?? false,
      resolved_at: row.resolved_at ?? null,
    },
  };
}

export function eventFromTask(row: TaskRow): TimelineEvent {
  const ts = instantOrCreated(row.created_at, null);
  return {
    id: `task:${row.id}`,
    type: 'task',
    timestamp: ts,
    title: row.title?.trim() || taskTypeTitle(row.task_type),
    description: row.description ?? null,
    severity: null,
    metadata: {
      task_type: row.task_type,
      priority: row.priority,
      status: row.status,
      related_alert_id: row.related_alert_id ?? null,
      resolved_at: row.resolved_at ?? null,
    },
  };
}

export function eventFromAudit(row: AuditRow, actorName: string | null): TimelineEvent {
  const meta = { ...(row.metadata ?? {}), actor_name: actorName };
  return {
    id: `audit:${row.id}`,
    type: 'audit',
    timestamp: row.created_at,
    title: actorName
      ? `${auditTimelineTitle(row.entity_type, row.action)} — ${actorName}`
      : `${auditTimelineTitle(row.entity_type, row.action)} — Sistema`,
    description: null,
    severity: null,
    metadata: meta,
  };
}

export function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    const ta = Date.parse(a.timestamp);
    const tb = Date.parse(b.timestamp);
    if (!Number.isFinite(ta) && !Number.isFinite(tb)) return a.id.localeCompare(b.id);
    if (!Number.isFinite(ta)) return 1;
    if (!Number.isFinite(tb)) return -1;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

export function mergeOperationalTimelineParts(parts: {
  punches: TimelineEvent[];
  repPending: TimelineEvent[];
  alerts: TimelineEvent[];
  tasks: TimelineEvent[];
  audits: TimelineEvent[];
}): TimelineEvent[] {
  return sortTimelineEvents([
    ...parts.punches,
    ...parts.repPending,
    ...parts.alerts,
    ...parts.tasks,
    ...parts.audits,
  ]);
}
