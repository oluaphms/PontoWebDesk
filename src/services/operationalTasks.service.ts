import { supabase } from './supabaseClient';

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
  const cid = companyId.trim();
  if (!cid) return [];
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');

  const res = await fetch(`/api/operational/tasks?company_id=${encodeURIComponent(cid)}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: OperationalTaskRow[];
    error?: string;
  };

  if (!res.ok || body.success === false) {
    throw new Error(body.error || 'Falha ao carregar tarefas operacionais');
  }

  return body.data ?? [];
}

export async function completeOperationalTask(taskId: string): Promise<void> {
  const id = taskId.trim();
  if (!id) throw new Error('ID da tarefa inválido.');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');

  const res = await fetch(`/api/operational/tasks/${encodeURIComponent(id)}/complete`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!res.ok || body.success === false) {
    throw new Error(body.error || 'Não foi possível concluir a tarefa');
  }
}
