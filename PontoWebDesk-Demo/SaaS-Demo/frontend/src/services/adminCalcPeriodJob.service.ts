import { auth } from './supabaseClient';
import { buildApiUrl } from './api';

type EnqueueResponse = {
  error?: string;
  details?: string;
  job_id?: string;
  success?: boolean;
  mode?: string;
  fallback?: string;
};

type JobStatusResponse = {
  status?: string;
  result?: { error?: string };
};

async function getAdminToken(): Promise<string> {
  const {
    data: { session },
  } = await auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');
  return token;
}

async function parseJsonSafe<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

export async function runCalcPeriodJob(params: {
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  timeoutMs?: number;
}): Promise<void> {
  const token = await getAdminToken();

  const enqueueUrl = buildApiUrl('/jobs/calc-period');
  const enqueueRes = await fetch(enqueueUrl, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      employee_id: params.employeeId,
      start_date: params.periodStart,
      end_date: params.periodEnd,
    }),
  });
  const enqueueJson = await parseJsonSafe<EnqueueResponse>(enqueueRes);
  if (!enqueueRes.ok) {
    const hint = enqueueJson?.details ? ` (${enqueueJson.details})` : '';
    throw new Error((enqueueJson?.error || 'Falha ao enfileirar cálculo.') + hint);
  }

  const directFallbackDone =
    enqueueJson.mode === 'direct_fallback' ||
    (enqueueJson.success === true && enqueueJson.fallback === 'calculatePeriodTimesheets');
  if (directFallbackDone) return;

  const jobId = enqueueJson.job_id;
  if (!jobId) throw new Error('Resposta sem job_id.');

  const processUrl = buildApiUrl('/jobs/process');
  void fetch(processUrl, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });

  const timeoutMs = params.timeoutMs ?? 15 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'pending';
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const statusUrl = buildApiUrl(`/jobs/${jobId}`);
    const statusRes = await fetch(statusUrl, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    const job = await parseJsonSafe<JobStatusResponse>(statusRes);
    lastStatus = String(job?.status ?? '');
    if (lastStatus === 'done') return;
    if (lastStatus === 'failed') {
      throw new Error(job?.result?.error || 'Job falhou.');
    }
  }

  throw new Error('Worker indisponível para cálculo em fila. Aplicando cálculo local neste dispositivo.');
}
