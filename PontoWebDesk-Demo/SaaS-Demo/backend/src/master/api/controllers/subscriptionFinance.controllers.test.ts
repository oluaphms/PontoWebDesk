// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import type { MasterApiRequest } from '../middlewares/requireMasterLogin.js';
import { postSubscriptionFinanceEntry } from './subscriptionFinance.controllers.js';

function responseMock(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('Fase 6.4 — autorização do financeiro Master', () => {
  it('rejeita mutação feita apenas com MASTER_API_KEY', async () => {
    const req = {
      params: { companyId: 'co-1' },
      body: { amountCents: 14900, dueAt: '2026-08-21T12:00:00.000Z' },
      masterKeyAuth: true,
      masterAuth: {
        userId: 'master-api-key',
        email: 'api-key@master.local',
        name: 'Master API Key',
        role: 'MASTER_OWNER',
        viaApiKey: true,
      },
    } as unknown as MasterApiRequest;
    const res = responseMock();

    await postSubscriptionFinanceEntry(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: 'MASTER_HUMAN_ACTOR_REQUIRED' });
  });
});

