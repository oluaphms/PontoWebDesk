import { SYSTEM_CONFIG } from '../config/system';
import { apiGet, apiPatch } from './api';
import { degradedResponse } from './degraded';

export type OperationalTaskRow = {
  id: string;
  company_id: string;
  employee_id: string | null;
  employee_name?: string | null;
  task_type: string;
  status: string;
  priority: string;
  title: string | null;
  description: string | null;
  related_alert_id: string | null;
  related_date: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

export async function fetchOperationalTasks(companyId: string): Promise<OperationalTaskRow[]> {
  if (SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API') {
    return degradedResponse<OperationalTaskRow[]>().data;
  }
  const cid = companyId.trim();
  if (!cid) return [];
  const body = await apiGet<{
    success?: boolean;
    data?: OperationalTaskRow[];
    error?: string;
  }>(`/operational/tasks?company_id=${encodeURIComponent(cid)}`);

  if (body.success === false) {
    throw new Error(body.error || 'Falha ao carregar tarefas operacionais');
  }

  return body.data ?? [];
}

export async function completeOperationalTask(taskId: string): Promise<void> {
  if (SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API') {
    return;
  }
  const id = taskId.trim();
  if (!id) throw new Error('ID da tarefa inválido.');
  const body = await apiPatch<{ success?: boolean; error?: string }>(
    `/operational/tasks/${encodeURIComponent(id)}/complete`,
    {},
  );
  if (body.success === false) {
    throw new Error(body.error || 'Não foi possível concluir a tarefa');
  }
}
