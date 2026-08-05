// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vitest';
import type { Response } from 'express';
import { MasterAuthService } from '../master/auth/MasterAuthService.js';
import { requireMasterAuth, requireMasterRole, type MasterRequest } from './masterAuth.js';
import { signMasterToken } from '../master/auth/MasterJWT.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe('Master Auth infrastructure', () => {
  beforeEach(() => {
    delete process.env.MASTER_API_KEY;
    delete process.env.MASTER_API_KEY_ENABLED;
    process.env.MASTER_JWT_SECRET = 'master-test-secret-not-company-jwt';
  });

  it('login MasterUser com MasterRole', async () => {
    const auth = MasterAuthService.createInMemory();
    await auth.createUser({
      email: 'owner@master.test',
      name: 'Owner',
      password: 'secret1234',
      role: 'MASTER_OWNER',
    });
    const session = await auth.login({
      email: 'owner@master.test',
      password: 'secret1234',
    });
    expect(session.role).toBe('MASTER_OWNER');
    expect(session.token).toBeTruthy();
  });

  it('requireMasterAuth aceita Bearer Master (não JWT empresa)', () => {
    const { token } = signMasterToken({
      userId: 'mu_1',
      email: 'a@b.c',
      name: 'A',
      role: 'MASTER_ADMIN',
      sessionId: 'msid_legacy_test',
    });
    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as unknown as MasterRequest;
    const res = mockRes();
    let next = false;
    requireMasterAuth()(req, res, () => {
      next = true;
    });
    expect(next).toBe(true);
    expect(req.masterAuth?.role).toBe('MASTER_ADMIN');
  });

  it('requireMasterRole bloqueia SUPPORT em rota FINANCE', () => {
    const req = {
      headers: {},
      masterAuth: {
        userId: '1',
        email: 's@m',
        name: 'S',
        role: 'MASTER_SUPPORT' as const,
      },
    } as MasterRequest;
    const res = mockRes();
    let next = false;
    requireMasterRole('MASTER_OWNER', 'MASTER_FINANCE')(req, res, () => {
      next = true;
    });
    expect(next).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('MASTER_API_KEY bootstrap não usa JWT empresa', () => {
    process.env.MASTER_API_KEY = 'boot-key';
    process.env.MASTER_API_KEY_ENABLED = 'true';
    const req = {
      headers: { 'x-master-key': 'boot-key' },
      method: 'GET',
    } as unknown as MasterRequest;
    const res = mockRes();
    let next = false;
    requireMasterAuth()(req, res, () => {
      next = true;
    });
    expect(next).toBe(true);
    expect(req.masterAuth?.viaApiKey).toBe(true);
    expect(req.masterAuth?.role).toBe('MASTER_AUDITOR');
  });
});
