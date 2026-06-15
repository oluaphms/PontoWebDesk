/**
 * Comandos REP via agente local (test_connection em LAN).
 */

import { apiGet, apiPost } from './api';
import { observabilityConsole } from '../shared/logger/observabilityConsole';

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
    diagnostics?: Record<string, unknown>;
    sent_ok?: number;
    uploaded?: number;
    parsed?: number;
    [key: string]: unknown;
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
/** Agente faz poll a cada ~5–60s — timeout cobre vários ciclos + execução LAN. */
export const REP_TEST_POLL_MAX_MS = 180_000;
/** Exchange (pull_clock, pull_info, etc.) — login.fcgi + .fcgi pode levar mais de 1 min. */
export const REP_EXCHANGE_POLL_MAX_MS = 300_000;
/** Coleta AFD + upload pode levar vários minutos em relógios grandes. */
export const REP_COLLECT_POLL_MAX_MS = 300_000;
export const REP_TEST_WAITING_HINT_MS = 15_000;
export const REP_TEST_SLOW_HINT_MS = 45_000;

export async function createRepTestConnectionCommand(
  deviceId: string,
  accessToken: string,
): Promise<CreateTestConnectionResult> {
  const data = (await apiPost(
    '/rep/commands',
    { device_id: deviceId, command: 'test_connection' },
    { headers: { Accept: 'application/json' } },
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
  options?: { commandId?: string; command?: string },
): Promise<RepDeviceCommandRow | null> {
  const qs = new URLSearchParams({ device_id: deviceId, latest: 'true' });
  if (options?.commandId) qs.set('command_id', options.commandId);
  if (options?.command) qs.set('command', options.command);
  const data = (await apiGet(`/rep/commands?${qs}`, {
    headers: { Accept: 'application/json' },
  })) as {
    error?: string;
    command?: RepDeviceCommandRow | null;
  };
  return data.command ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RepCommandPollOutcome =
  | { ok: true; status: 'done'; command: RepDeviceCommandRow }
  | { ok: false; status: 'error' | 'cancelled' | 'timeout'; message: string; command?: RepDeviceCommandRow | null };

/** Aguarda comando REP (exchange, push_employee, etc.) concluir no agente. */
export async function pollRepCommandResult(
  deviceId: string,
  commandId: string,
  accessToken: string,
  options?: { intervalMs?: number; maxMs?: number; onProgress?: (status: RepCommandPollStatus) => void },
): Promise<RepCommandPollOutcome> {
  const intervalMs = options?.intervalMs ?? REP_TEST_POLL_INTERVAL_MS;
  const maxMs = options?.maxMs ?? REP_EXCHANGE_POLL_MAX_MS;
  const deadline = Date.now() + maxMs;
  let lastLoggedStatus: string | null = null;
  let lastProgressAt = Date.now();

  while (Date.now() < deadline) {
    const row = await fetchLatestRepDeviceCommand(deviceId, accessToken, { commandId });
    const status = (row?.status as RepCommandPollStatus) ?? null;
    if (status !== lastLoggedStatus) {
      lastLoggedStatus = status;
      observabilityConsole.info('[REP-FLOW] poll command status', {
        device_id: deviceId,
        command_id: commandId,
        status,
        execution_id: row?.execution_id ?? null,
      });
    }
    if (Date.now() - lastProgressAt >= 15_000) {
      lastProgressAt = Date.now();
      options?.onProgress?.(status);
    }
    if (row?.status === 'done') {
      return { ok: true, status: 'done', command: row };
    }
    if (row?.status === 'error' || row?.status === 'cancelled') {
      const result = row.result ?? {};
      const msg =
        String(result.message || '').trim() ||
        (row.status === 'cancelled' ? 'Comando cancelado.' : 'Comando falhou no agente.');
      return { ok: false, status: row.status, message: msg, command: row };
    }
    await sleep(intervalMs);
  }

  observabilityConsole.warn('[REP-FLOW] poll command timeout', {
    device_id: deviceId,
    command_id: commandId,
    max_ms: maxMs,
    last_status: lastLoggedStatus,
  });
  return { ok: false, status: 'timeout', message: 'AGENT_COMMAND_TIMEOUT', command: null };
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
    const row = await fetchLatestRepDeviceCommand(deviceId, accessToken, { commandId });
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
