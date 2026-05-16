/**
 * Integração task ⇄ alerta (handlers API + recálculo de risco).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const riskMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const { mockFrom, createClient } = vi.hoisted(() => {
  const mf = vi.fn();
  const cc = vi.fn(() => ({ from: mf }));
  return { mockFrom: mf, createClient: cc };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient,
}));

vi.mock('../../../modules/alerts/operationalAlertsEngine', () => ({
  evaluateAndNotifyCompanyOperationalRisk: riskMock,
}));

vi.mock('../../../modules/alerts/riskExecutionGuard', () => ({
  runRiskOnce: async (_companyId: string, fn: () => Promise<void>) => {
    await fn();
  },
}));

vi.mock('../../../modules/audit/auditLogger', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../security.js', () => ({
  getSecureCorsHeaders: vi.fn(() => ({})),
  checkRateLimit: vi.fn(() => ({ allowed: true, resetAt: Date.now() + 60_000 })),
  getClientIP: vi.fn(() => '127.0.0.1'),
  extractBearerToken: vi.fn((req: Request) => req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')?.trim() ?? ''),
  secureCompare: vi.fn((a: string, b: string) => a === b),
}));

vi.mock('../getSupabaseConfig.js', () => ({
  getSupabaseConfig: vi.fn(() => ({ url: 'https://test.supabase.co', serviceKey: 'sk' })),
}));

import tasksMod from '../route-handlers/operationalTasks';
import alertsMod from '../route-handlers/operationalAlerts';

const API_KEY = 'integration-test-api-key';

afterEach(() => {
  delete process.env.API_KEY;
});

function patchTasksComplete(taskId: string) {
  return new Request(`https://localhost/api/operational-tasks/${taskId}/complete`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Host: 'localhost',
    },
  });
}

function patchAlertResolve(alertId: string) {
  return new Request(`https://localhost/api/operational-alerts/${alertId}/resolve`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Host: 'localhost',
    },
  });
}

describe('operationalTasks.integration — PATCH task complete', () => {
  beforeEach(() => {
    process.env.API_KEY = API_KEY;
    riskMock.mockClear();
    mockFrom.mockReset();
  });

  it('concluir task resolve alerta vinculado e recalcula risco', async () => {
    let taskFromN = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'operational_tasks') {
        taskFromN++;
        if (taskFromN === 1) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 't1',
                    company_id: 'c1',
                    related_alert_id: 'a1',
                    status: 'pending',
                    version: 0,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: { id: 't1', company_id: 'c1', version: 1 },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'operational_alerts') {
        return {
          update: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: null as null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const res = await tasksMod.fetch(patchTasksComplete('t1'));
    const body = (await res.json()) as { success?: boolean; error?: string };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(riskMock).toHaveBeenCalledTimes(1);
    expect(riskMock).toHaveBeenCalledWith(expect.anything(), 'c1');
    const alertsCalls = mockFrom.mock.calls.filter((c) => c[0] === 'operational_alerts').length;
    expect(alertsCalls).toBeGreaterThanOrEqual(1);
  });

  it('não quebra sem related_alert_id (não toca em operational_alerts)', async () => {
    let taskFromN = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'operational_tasks') {
        taskFromN++;
        if (taskFromN === 1) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 't2',
                    company_id: 'c9',
                    related_alert_id: null,
                    status: 'pending',
                    version: 0,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: { id: 't2', version: 1 },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const res = await tasksMod.fetch(patchTasksComplete('t2'));
    expect(res.status).toBe(200);
    expect(riskMock).toHaveBeenCalledWith(expect.anything(), 'c9');
    expect(mockFrom.mock.calls.every((c) => c[0] !== 'operational_alerts')).toBe(true);
  });

  it('falha ao resolver alerta reverte task para pending', async () => {
    let taskFromN = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'operational_tasks') {
        taskFromN++;
        if (taskFromN === 1) {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 't3',
                    company_id: 'c1',
                    related_alert_id: 'a9',
                    status: 'pending',
                    version: 0,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (taskFromN === 2) {
          return {
            update: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => ({
                      data: { id: 't3', version: 1 },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {
          update: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: null as null }),
            }),
          }),
        };
      }
      if (table === 'operational_alerts') {
        return {
          update: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: { message: 'fail' } }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const res = await tasksMod.fetch(patchTasksComplete('t3'));
    expect(res.status).toBe(500);
    const taskUpdates = mockFrom.mock.calls.filter((c) => c[0] === 'operational_tasks').length;
    expect(taskUpdates).toBeGreaterThanOrEqual(2);
  });

  it('task já concluída retorna 200 idempotente', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table !== 'operational_tasks') throw new Error(`unexpected ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: 't9',
                company_id: 'c1',
                related_alert_id: null,
                status: 'done',
                version: 3,
                resolved_at: '2026-05-06T12:00:00.000Z',
              },
              error: null,
            }),
          }),
        }),
      };
    });

    const res = await tasksMod.fetch(patchTasksComplete('t9'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { idempotent?: boolean };
    expect(body.idempotent).toBe(true);
  });
});

describe('operationalTasks.integration — PATCH alert resolve (fecha tasks)', () => {
  beforeEach(() => {
    process.env.API_KEY = API_KEY;
    riskMock.mockClear();
    mockFrom.mockReset();
  });

  it('resolver alerta manualmente fecha tasks ligadas (batch eq+neq)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'operational_alerts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'a1', company_id: 'c1' }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () =>
                  Promise.resolve({
                    data: [{ id: 'a1' }],
                    error: null as null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === 'operational_tasks') {
        return {
          update: () => ({
            eq: () => ({
              neq: () => Promise.resolve({ error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const res = await alertsMod.fetch(patchAlertResolve('a1'));
    expect(res.status).toBe(200);
    expect(riskMock).toHaveBeenCalledWith(expect.anything(), 'c1');
    const taskCalls = mockFrom.mock.calls.filter((c) => c[0] === 'operational_tasks');
    expect(taskCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('uma única chamada de update em tasks afeta todas com o mesmo related_alert_id', async () => {
    const taskBuilder = {
      update: () => ({
        eq: () => ({
          neq: () => Promise.resolve({ error: null }),
        }),
      }),
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'operational_alerts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'ax', company_id: 'cx' }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: () =>
                  Promise.resolve({
                    data: [{ id: 'ax' }],
                    error: null as null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === 'operational_tasks') return taskBuilder;
      throw new Error(`unexpected table ${table}`);
    });

    await alertsMod.fetch(patchAlertResolve('ax'));
    const updates = mockFrom.mock.calls.filter((c) => c[0] === 'operational_tasks');
    expect(updates.length).toBe(1);
  });
});
