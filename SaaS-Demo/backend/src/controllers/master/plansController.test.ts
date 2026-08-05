// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Response } from 'express';
import type { MasterApiRequest } from '../../master/api/middlewares/requireMasterLogin.js';
import { postMasterPlanController } from './plansController.js';

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

describe('Fase 6.3 — segurança dos planos Master', () => {
  it('não permite mutação por MASTER_API_KEY sem usuário humano', async () => {
    const req = {
      body: {
        name: 'Pro',
        cycle: 'MONTHLY',
        priceCents: 19900,
        employeeLimit: 100,
        userLimit: 10,
        enabledModules: ['PONTO'],
      },
      masterKeyAuth: true,
      masterAuth: {
        userId: 'master-api-key',
        email: 'api-key@master.local',
        name: 'Master API Key',
        role: 'MASTER_OWNER',
        viaApiKey: true,
      },
    } as MasterApiRequest;
    const res = responseMock();

    await postMasterPlanController(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: 'MASTER_HUMAN_ACTOR_REQUIRED' });
  });
});
