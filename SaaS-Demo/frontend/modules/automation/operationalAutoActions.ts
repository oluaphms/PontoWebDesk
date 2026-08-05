import { observabilityConsole } from '../../src/shared/logger/observabilityConsole';
/**
 * Geração idempotente de tarefas operacionais a partir de alertas do mesmo pipeline.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GeneratedOperationalAlert, OperationalAlertType } from '../alerts/operationalAlertsEngine';
import { notifyOperationalTask } from '../alerts/operationalNotifier';
import { logAudit } from '../audit/auditLogger';

/** `task_type` persistido (REP usa rep_pending, não rep_pending_stale). */
export type OperationalTaskType =
  | 'missing_exit'
  | 'long_break'
  | 'rep_pending'
  | 'inconsistency'
  | 'excess_hours';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type OperationalTaskDraft = {
  task_type: OperationalTaskType;
  priority: TaskPriority;
  title: string;
  description: string;
  related_alert_id: string | null;
};

export function alertTypeToTaskType(alertType: OperationalAlertType): OperationalTaskType | null {
  switch (alertType) {
    case 'missing_exit':
      return 'missing_exit';
    case 'long_break':
      return 'long_break';
    case 'inconsistency':
      return 'inconsistency';
    case 'rep_pending_stale':
      return 'rep_pending';
    case 'excess_hours':
      return 'excess_hours';
    default:
      return null;
  }
}

/**
 * Regras de produto: título, prioridade e descrição por tipo de alerta.
 * REP pendente força prioridade high (pedido).
 */
export function taskDraftFromAlert(
  alert: GeneratedOperationalAlert,
  relatedAlertId: string | null,
): OperationalTaskDraft | null {
  const task_type = alertTypeToTaskType(alert.type);
  if (!task_type) return null;

  let priority: TaskPriority = alert.severity;
  let title: string;
  let description: string;

  switch (alert.type) {
    case 'missing_exit':
      priority = 'high';
      title = 'Colaborador sem saída registrada';
      description = alert.message;
      break;
    case 'long_break':
      priority = 'medium';
      title = 'Pausa acima do permitido';
      description = alert.message;
      break;
    case 'inconsistency':
      priority = 'critical';
      title = 'Inconsistência no espelho de ponto';
      description = alert.message;
      break;
    case 'rep_pending_stale':
      priority = 'high';
      title = 'Batidas pendentes do REP';
      description = alert.message;
      break;
    case 'excess_hours':
      title = 'Jornada acima do limite';
      description = alert.message;
      break;
    default:
      title = alert.message;
      description = alert.message;
  }

  return {
    task_type,
    priority,
    title,
    description,
    related_alert_id: relatedAlertId,
  };
}

/** Uso em testes: lista de rascunhos sem I/O. */
export function buildOperationalTaskDrafts(
  alerts: GeneratedOperationalAlert[],
  alertIdByType: Partial<Record<OperationalAlertType, string>>,
): OperationalTaskDraft[] {
  const out: OperationalTaskDraft[] = [];
  for (const a of alerts) {
    const rel = alertIdByType[a.type] ?? null;
    const d = taskDraftFromAlert(a, rel);
    if (d) out.push(d);
  }
  return out;
}

export type GenerateOperationalTasksParams = {
  supabase: SupabaseClient;
  companyId: string;
  employeeId: string;
  date: string;
  alerts: GeneratedOperationalAlert[];
};

/**
 * Garante uma tarefa aberta por (empresa, colaborador, dia, task_type) via índice único parcial.
 * Liga `related_alert_id` aos alertas já persistidos no mesmo dia.
 */
export async function generateOperationalTasks({
  supabase,
  companyId,
  employeeId,
  date,
  alerts,
}: GenerateOperationalTasksParams): Promise<void> {
  const company = companyId.trim();
  const emp = employeeId.trim();
  const day = date.trim();
  if (!company || !emp || !day || !alerts.length) return;

  const { data: dbAlerts, error: fetchErr } = await supabase
    .from('operational_alerts')
    .select('id, alert_type')
    .eq('company_id', company)
    .eq('employee_id', emp)
    .eq('date', day)
    .eq('resolved', false);

  if (fetchErr) {
    observabilityConsole.error('[AUTO TASKS] Falha ao ler alertas', { companyId: company, message: fetchErr.message });
    return;
  }

  const alertIdByType: Partial<Record<OperationalAlertType, string>> = {};
  for (const row of dbAlerts ?? []) {
    const t = row.alert_type as OperationalAlertType | undefined;
    const id = row.id as string | undefined;
    if (t && id) alertIdByType[t] = id;
  }

  for (const alert of alerts) {
    const draft = taskDraftFromAlert(alert, alertIdByType[alert.type] ?? null);
    if (!draft) continue;

    const { data: existing, error: exErr } = await supabase
      .from('operational_tasks')
      .select('id')
      .eq('company_id', company)
      .eq('employee_id', emp)
      .eq('related_date', day)
      .eq('task_type', draft.task_type)
      .neq('status', 'done')
      .maybeSingle();

    if (exErr) {
      observabilityConsole.error('[AUTO TASKS] Falha ao verificar duplicata', { message: exErr.message });
      continue;
    }
    if (existing?.id) continue;

    const { data: inserted, error: insErr } = await supabase
      .from('operational_tasks')
      .insert({
        company_id: company,
        employee_id: emp,
        task_type: draft.task_type,
        status: 'pending',
        priority: draft.priority,
        title: draft.title,
        description: draft.description,
        related_alert_id: draft.related_alert_id,
        related_date: day,
      })
      .select('id, task_type, priority, title, company_id, employee_id')
      .maybeSingle();

    if (insErr) {
      if (insErr.code === '23505') {
        continue;
      }
      observabilityConsole.error('[AUTO TASKS] Insert falhou', { message: insErr.message, task_type: draft.task_type });
      continue;
    }

    if (inserted) {
      observabilityConsole.log('[AUTO TASK CREATED]', {
        companyId: company,
        employeeId: emp,
        task_type: draft.task_type,
        task_id: inserted.id,
      });

      await notifyOperationalTask({
        task_type: inserted.task_type as string,
        priority: inserted.priority as string,
        company_id: inserted.company_id as string,
        employee_id: inserted.employee_id as string | null,
        title: inserted.title as string | null,
      });

      await logAudit({
        supabase,
        companyId: company,
        actorId: null,
        entityType: 'task',
        entityId: String(inserted.id),
        action: 'created',
        before: null,
        after: {
          status: 'pending',
          task_type: draft.task_type,
          employee_id: emp,
          related_date: day,
        },
        metadata: {
          auto: true,
          reason: alert.type,
        },
      });
    }
  }
}
