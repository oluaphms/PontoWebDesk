import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  pollRepTestConnectionResult,
  REP_TEST_POLL_INTERVAL_MS,
  REP_TEST_WAITING_HINT_MS,
} from './repDeviceCommands.service';

describe('pollRepTestConnectionResult', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna sucesso quando comando conclui com done', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          command: {
            id: 'cmd-1',
            status: 'done',
            result: { success: true, message: 'OK', response_time_ms: 120 },
          },
        }),
      }),
    );

    const outcome = await pollRepTestConnectionResult('dev-1', 'cmd-1', 'token', {
      intervalMs: 10,
      maxMs: 100,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.responseTimeMs).toBe(120);
    }
  });

  it(
    'emite waiting_agent após 10s',
    async () => {
    const phases: string[] = [];
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        calls += 1;
        if (calls < 12) {
          return {
            ok: true,
            json: async () => ({ command: { id: 'cmd-1', status: 'pending', result: null } }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            command: { id: 'cmd-1', status: 'done', result: { success: true, message: 'OK' } },
          }),
        };
      }),
    );

    await pollRepTestConnectionResult('dev-1', 'cmd-1', 'token', {
      intervalMs: REP_TEST_POLL_INTERVAL_MS,
      maxMs: REP_TEST_WAITING_HINT_MS + 500,
      onProgress: (p) => phases.push(p),
    });
    expect(phases).toContain('waiting_agent');
    },
    15_000,
  );

  it('timeout quando agente não responde', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ command: { id: 'cmd-1', status: 'pending', result: null } }),
      }),
    );

    const outcome = await pollRepTestConnectionResult('dev-1', 'cmd-1', 'token', {
      intervalMs: 20,
      maxMs: 60,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.timedOut).toBe(true);
  });
});
