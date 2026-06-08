/**
 * Comandos REP via agente local (test_connection em LAN).
 */

import { apiGet, apiPost } from './api';

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
export type RepCommandPollStatus = 'pending' | 'processing' | 'done' | 'error' | 'cancelled' | null;

export type PollTestConnectionOutcome =
  | { ok: true; message: string; responseTimeMs?: number }
  | { ok: false; message: string; timedOut?: boolean; slowAgent?: boolean };

export const REP_TEST_POLL_INTERVAL_MS = 1000;
/** Agente faz poll a cada ~15–60s — timeout cobre vários ciclos + execução LAN. */
export const REP_TEST_POLL_MAX_MS = 120_000;
export const REP_TEST_WAITING_HINT_MS = 15_000;
export const REP_TEST_SLOW_HINT_MS = 45_000;

export async function createRepTestConnectionCommand(
  deviceId: string,
  accessToken: string,
): Promise<CreateTestConnectionResult> {
  const data = (await apiPost(
    '/rep/commands',
    { device_id: deviceId, command: 'test_connection' },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
  )) as {
    error?: string;
    command_id?: string;
    status?: string;
    reused?: boolean;
  };
  if (!data.command_id) {
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
  const data = (await apiGet(`/rep/commands?${qs}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  })) as {
    error?: string;
    command?: RepDeviceCommandRow | null;
  };
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
    onProgress?: (phase: PollTestProgressPhase, commandStatus?: RepCommandPollStatus) => void;
  },
): Promise<PollTestConnectionOutcome> {
  const intervalMs = options?.intervalMs ?? REP_TEST_POLL_INTERVAL_MS;
  const maxMs = options?.maxMs ?? REP_TEST_POLL_MAX_MS;
  const started = Date.now();
  const deadline = started + maxMs;
  let lastPhase: PollTestProgressPhase = 'polling';
  let lastStatus: RepCommandPollStatus = null;

  const emit = (phase: PollTestProgressPhase, commandStatus?: RepCommandPollStatus) => {
    const status = commandStatus ?? null;
    if (phase === lastPhase && status === lastStatus) return;
    lastPhase = phase;
    lastStatus = status;
    options?.onProgress?.(phase, status);
  };

  while (Date.now() < deadline) {
    const elapsed = Date.now() - started;
    const row = await fetchLatestRepDeviceCommand(deviceId, accessToken, commandId);
    const commandStatus = (row?.status as RepCommandPollStatus) ?? null;
    if (elapsed >= REP_TEST_SLOW_HINT_MS) emit('agent_slow', commandStatus);
    else if (elapsed >= REP_TEST_WAITING_HINT_MS) emit('waiting_agent', commandStatus);
    else emit('polling', commandStatus);
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
    message: 'AGENT_COMMAND_TIMEOUT',
    timedOut: true,
    slowAgent: lastPhase === 'agent_slow',
  };
}
