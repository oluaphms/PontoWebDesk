/**
 * Concorrência: duplo PATCH complete na mesma task (lock otimista).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../modules/alerts/operationalAlertsEngine', () => ({
  evaluateAndNotifyCompanyOperationalRisk: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../modules/audit/auditLogger', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../modules/alerts/riskExecutionGuard', () => ({
  runRiskOnce: async (_companyId: string, fn: () => Promise<void>) => {
    await fn();
  },
}));

const { mockFrom, createClient } = vi.hoisted(() => {
  const mf = vi.fn();
  const cc = vi.fn(() => ({ from: mf }));
  return { mockFrom: mf, createClient: cc };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient,
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

const API_KEY = 'concurrency-test-api-key';

afterEach(() => {
  delete process.env.API_KEY;
});

describe('operationalConcurrency', () => {
  beforeEach(() => {
    process.env.API_KEY = API_KEY;
    mockFrom.mockReset();

    let version = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table !== 'operational_tasks') {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: 'tc',
                company_id: 'c1',
                related_alert_id: null,
                status: 'pending',
                version,
              },
              error: null,
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: (_c2: string, expectedVersion: number) => ({
              select: () => ({
                maybeSingle: async () => {
                  if (expectedVersion !== version) {
                    return { data: null, error: null };
                  }
                  version += 1;
                  return {
                    data: {
                      id: 'tc',
                      company_id: 'c1',
                      version,
                      status: 'done',
                    },
                    error: null,
                  };
                },
              }),
            }),
          }),
        }),
      };
    });
  });

  it('Promise.all: um 200 e um 409; estado final consistente', async () => {
    const r1 = tasksMod.fetch(
      new Request('https://localhost/api/operational-tasks/tc/complete', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${API_KEY}`, Host: 'localhost' },
      }),
    );
    const r2 = tasksMod.fetch(
      new Request('https://localhost/api/operational-tasks/tc/complete', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${API_KEY}`, Host: 'localhost' },
      }),
    );

    const [resA, resB] = await Promise.all([r1, r2]);
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const ok = resA.status === 200 ? resA : resB;
    const conflict = resA.status === 409 ? resA : resB;
    const okBody = (await ok.json()) as { success?: boolean };
    const conflictBody = (await conflict.json()) as { success?: boolean; error?: string };
    expect(okBody.success).toBe(true);
    expect(conflictBody.success).toBe(false);
    expect(conflictBody.error).toBe('TASK_CONFLICT');
  });
});
