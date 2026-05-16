import type { OperationalSlaConfigRow } from './operationalRiskEngine';

export type OperationalTaskNotifyPayload = {
  task_type: string;
  priority: string;
  company_id: string;
  employee_id?: string | null;
  title?: string | null;
};

/**
 * Notificações de tarefa operacional (fila de ação humana / auto-remediação).
 * Crítico: canal imediato (estrutura pronta para WhatsApp / e-mail / webhook).
 * Alto: registo + fila (batch / digest).
 */
export async function notifyOperationalTask(task: OperationalTaskNotifyPayload): Promise<void> {
  console.log('[NOTIFY TASK]', {
    type: task.task_type,
    priority: task.priority,
  });

  if (task.priority === 'critical') {
    console.log('[NOTIFY TASK IMMEDIATE]', {
      companyId: task.company_id,
      employeeId: task.employee_id,
      title: task.title,
      taskType: task.task_type,
    });
    // Futuro imediato: sendWhatsAppImmediate(...) | sendEmailImmediate(...) | webhookCritical(...)
  } else if (task.priority === 'high') {
    console.log('[NOTIFY TASK QUEUE]', {
      companyId: task.company_id,
      employeeId: task.employee_id,
      title: task.title,
      taskType: task.task_type,
    });
    // Futuro fila: enqueueOperationalNotification(...)
  }
}

export type NotifyIfCriticalRiskParams = {
  companyId: string;
  risk: string;
  sla?: OperationalSlaConfigRow | null;
};

/**
 * Dispara notificações quando o risco agregado é crítico.
 * Hoje: log estruturado; futuro: e-mail / WhatsApp conforme `notify_*` no SLA.
 */
export async function notifyIfCriticalRisk({ companyId, risk, sla }: NotifyIfCriticalRiskParams): Promise<void> {
  if (risk !== 'critical') return;

  const channels = {
    email: sla?.notify_email !== false,
    whatsapp: sla?.notify_whatsapp === true,
  };

  console.log('[ALERT NOTIFY]', {
    companyId,
    risk,
    channels,
  });

  if (channels.email) {
    // Futuro: sendEmail(...)
  }
  if (channels.whatsapp) {
    // Futuro: sendWhatsApp(...)
  }
}
