/**
 * Comandos REP via agente local (test_connection em LAN).
 */

export type RepDeviceCommandRow = {
  id: string;
  device_id: string;
  command: string;
  status: 'pending' | 'processing' | 'done' | 'error' | 'cancelled';
  execution_id?: string | null;
  result?: {
    success?: boolean;
    message?: string;
    response_time_ms?: number;
    latency_ms?: number;
    attempt?: number;
    agent_version?: string;
    device_ip?: string;
  } | null;
  created_at?: string;
  updated_at?: string;
};

export type CreateTestConnectionResult = {
  command_id: string;
  status: string;
  reused?: boolean;
};

export type PollTestProgressPhase = 'polling' | 'waiting_agent' | 'agent_slow';

export type PollTestConnectionOutcome =
  | { ok: true; message: string; responseTimeMs?: number }
  | { ok: false; message: string; timedOut?: boolean; slowAgent?: boolean };

export const REP_TEST_POLL_INTERVAL_MS = 1000;
export const REP_TEST_POLL_MAX_MS = 20_000;
export const REP_TEST_WAITING_HINT_MS = 10_000;
export const REP_TEST_SLOW_HINT_MS = 20_000;

export async function createRepTestConnectionCommand(
  deviceId: string,
  accessToken: string,
): Promise<CreateTestConnectionResult> {
  const res = await fetch('/api/rep/commands', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ device_id: deviceId, command: 'test_connection' }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    command_id?: string;
    status?: string;
    reused?: boolean;
  };
  if (!res.ok || !data.command_id) {
    throw new Error(data.error || 'Não foi possível solicitar o teste via agente.');
  }
  return {
    command_id: data.command_id,
    status: data.status || 'pending',
    reused: data.reused,
  };
}

export async function fetchLatestRepDeviceCommand(
  deviceId: string,
  accessToken: string,
  commandId?: string,
): Promise<RepDeviceCommandRow | null> {
  const qs = new URLSearchParams({ device_id: deviceId, latest: 'true' });
  if (commandId) qs.set('command_id', commandId);
  const res = await fetch(`/api/rep/commands?${qs}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    command?: RepDeviceCommandRow | null;
  };
  if (!res.ok) {
    throw new Error(data.error || 'Falha ao consultar resultado do teste.');
  }
  return data.command ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollRepTestConnectionResult(
  deviceId: string,
  commandId: string,
  accessToken: string,
  options?: {
    intervalMs?: number;
    maxMs?: number;
    onProgress?: (phase: PollTestProgressPhase) => void;
  },
): Promise<PollTestConnectionOutcome> {
  const intervalMs = options?.intervalMs ?? REP_TEST_POLL_INTERVAL_MS;
  const maxMs = options?.maxMs ?? REP_TEST_POLL_MAX_MS;
  const started = Date.now();
  const deadline = started + maxMs;
  let lastPhase: PollTestProgressPhase = 'polling';

  const emit = (phase: PollTestProgressPhase) => {
    if (phase === lastPhase) return;
    lastPhase = phase;
    options?.onProgress?.(phase);
  };

  while (Date.now() < deadline) {
    const elapsed = Date.now() - started;
    if (elapsed >= REP_TEST_SLOW_HINT_MS) emit('agent_slow');
    else if (elapsed >= REP_TEST_WAITING_HINT_MS) emit('waiting_agent');
    else emit('polling');

    const row = await fetchLatestRepDeviceCommand(deviceId, accessToken, commandId);
    if (row && (row.status === 'done' || row.status === 'error' || row.status === 'cancelled')) {
      const result = row.result ?? {};
      const success = row.status === 'done' && result.success !== false;
      const latency =
        typeof result.latency_ms === 'number'
          ? result.latency_ms
          : typeof result.response_time_ms === 'number'
            ? result.response_time_ms
            : undefined;
      const msg =
        String(result.message || '').trim() ||
        (success ? 'Relógio respondeu corretamente.' : 'Não foi possível conectar ao dispositivo.');
      if (success) {
        return {
          ok: true,
          message: msg,
          responseTimeMs: latency,
        };
      }
      return { ok: false, message: msg };
    }
    await sleep(intervalMs);
  }

  return {
    ok: false,
    message:
      'O agente na empresa não respondeu a tempo. Verifique se o Agente PontoWebDesk está em execução na rede do relógio.',
    timedOut: true,
    slowAgent: lastPhase === 'agent_slow',
  };
}
