// @vitest-environment node
/**
 * Smoke HTTP da API Master — Express isolado (sem DB / sem operacional).
 *
 * Isolamento de ambiente: o Vitest/dotenvx injeta `.env` local (MASTER_OWNER_1_*),
 * que tem precedência no bootstrap. Este harness limpa esses slots e fixa
 * credenciais de teste antes de subir o router.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  MasterPlatformService,
  resetMasterApiContext,
} from '../../services/master/masterPlatformService.js';

const TEST_OWNER_EMAIL = 'owner@master.test';
const TEST_OWNER_PASSWORD = 'master-pass-1234';
const TEST_OWNER_NAME = 'Owner Test';
const TEST_API_KEY = 'master-test-api-key';
const TEST_JWT_SECRET = 'test-master-jwt-secret-only-with-32-bytes';

/** Garante que o bootstrap Master usa somente as credenciais deste harness. */
function applyMasterHttpTestEnv(): void {
  for (const key of [
    'MASTER_OWNER_EMAIL',
    'MASTER_OWNER_PASSWORD',
    'MASTER_OWNER_NAME',
    'MASTER_OWNER_1_EMAIL',
    'MASTER_OWNER_1_PASSWORD',
    'MASTER_OWNER_1_NAME',
    'MASTER_OWNER_2_EMAIL',
    'MASTER_OWNER_2_PASSWORD',
    'MASTER_OWNER_2_NAME',
  ]) {
    delete process.env[key];
  }
  process.env.MASTER_JWT_SECRET = TEST_JWT_SECRET;
  process.env.MASTER_API_KEY = TEST_API_KEY;
  process.env.MASTER_PERSISTENCE = 'memory';
  process.env.MASTER_OWNER_EMAIL = TEST_OWNER_EMAIL;
  process.env.MASTER_OWNER_PASSWORD = TEST_OWNER_PASSWORD;
  process.env.MASTER_OWNER_NAME = TEST_OWNER_NAME;
}

applyMasterHttpTestEnv();

describe('master/api HTTP', () => {
  let baseUrl = '';
  let server: Server;
  let token = '';

  beforeAll(async () => {
    applyMasterHttpTestEnv();
    resetMasterApiContext();
    const { default: masterApiRouter } = await import('./routes/masterApiRouter.js');
    const app = express();
    app.use(express.json());
    app.use('/api/master', masterApiRouter);
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/api/master`;
    // Garante Owner de teste criado antes do primeiro login HTTP.
    await MasterPlatformService.getAuth().ensureBootstrapOwners();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('login Master emite JWT separado', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: TEST_OWNER_EMAIL,
        password: TEST_OWNER_PASSWORD,
      }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain('pwd_master_session=');
    expect(setCookie).not.toContain('pwd_session=');
    const body = (await res.json()) as {
      ok: boolean;
      tokenType: string;
      session: { token: string; role: string; tokenType: string; permissions: string[] };
    };
    expect(body.ok).toBe(true);
    expect(body.tokenType).toBe('master');
    expect(body.session.tokenType).toBe('master');
    expect(body.session.role).toBe('MASTER_OWNER');
    expect(body.session.token).toBeTruthy();
    expect(body.session.permissions.length).toBeGreaterThan(0);
    token = body.session.token;
  });

  it('audita estados distintos de login sem enumerar contas na resposta', async () => {
    const auth = MasterPlatformService.getAuth();
    const blocked = await auth.createUser({
      email: 'blocked@master.test',
      name: 'Blocked',
      password: 'blocked-pass-1234',
      role: 'MASTER_SUPPORT',
    });
    await auth.updateUser(blocked.id, { active: false });

    const attempts = [
      { email: TEST_OWNER_EMAIL, password: 'wrong-password' },
      { email: 'unknown@master.test', password: 'wrong-password' },
      { email: 'blocked@master.test', password: 'blocked-pass-1234' },
    ];
    for (const body of attempts) {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(401);
      const payload = (await res.json()) as { code: string; message: string };
      // Resposta pública permanece genérica (anti-enumeração).
      expect(payload.code).toBe('MASTER_LOGIN_FAILED');
      expect(payload.message).toBe('Credenciais Master inválidas.');
    }

    const auditRes = await fetch(`${baseUrl}/audit?resource=auth&limit=100`, {
      headers: { 'x-master-key': TEST_API_KEY },
    });
    expect(auditRes.status).toBe(200);
    const auditBody = (await auditRes.json()) as {
      audit: Array<{ action: string }>;
    };
    const actions = auditBody.audit.map((row) => row.action);
    expect(actions).toContain('LOGIN_SUCCESS');
    expect(actions).toContain('LOGIN_INVALID_PASSWORD');
    expect(actions).toContain('LOGIN_UNKNOWN_ACCOUNT');
    expect(actions).toContain('LOGIN_BLOCKED_ACCOUNT');
  });

  it('audita expiração de access token como LOGIN_SESSION_EXPIRED', async () => {
    const auth = MasterPlatformService.getAuth();
    await auth.createUser({
      email: 'expiry@master.test',
      name: 'Expiry',
      password: 'expiry-pass-1234',
      role: 'MASTER_AUDITOR',
    });

    const previousTtl = process.env.MASTER_JWT_EXPIRES_IN;
    process.env.MASTER_JWT_EXPIRES_IN = '1ms';
    let expiredToken = '';
    try {
      const login = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'expiry@master.test',
          password: 'expiry-pass-1234',
        }),
      });
      expect(login.status).toBe(200);
      const body = (await login.json()) as { session: { token: string } };
      expiredToken = body.session.token;
    } finally {
      if (previousTtl === undefined) delete process.env.MASTER_JWT_EXPIRES_IN;
      else process.env.MASTER_JWT_EXPIRES_IN = previousTtl;
    }

    await new Promise((resolve) => setTimeout(resolve, 15));
    const me = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(me.status).toBe(401);

    const auditRes = await fetch(
      `${baseUrl}/audit?action=LOGIN_SESSION_EXPIRED&limit=20`,
      { headers: { 'x-master-key': TEST_API_KEY } },
    );
    const auditBody = (await auditRes.json()) as {
      audit: Array<{ action: string; actorEmail: string | null }>;
    };
    expect(
      auditBody.audit.some(
        (row) =>
          row.action === 'LOGIN_SESSION_EXPIRED' &&
          row.actorEmail === 'expiry@master.test',
      ),
    ).toBe(true);
  });

  it('refresh e logout Master (revoga sessão)', async () => {
    const refreshRes = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    expect(refreshRes.status).toBe(200);
    const refreshed = (await refreshRes.json()) as {
      ok: boolean;
      session: { token: string; tokenType: string; refreshToken: string; sessionId: string };
    };
    expect(refreshed.ok).toBe(true);
    expect(refreshed.session.tokenType).toBe('master');
    expect(refreshed.session.refreshToken).toBeTruthy();
    expect(refreshed.session.sessionId).toBeTruthy();
    const revokedToken = refreshed.session.token;
    token = refreshed.session.token;

    const meRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meRes.status).toBe(200);
    const me = (await meRes.json()) as { ok: boolean; permissions: string[]; tokenType: string };
    expect(me.ok).toBe(true);
    expect(me.tokenType).toBe('master');
    expect(me.permissions).toContain('dashboard:read');

    const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logoutRes.status).toBe(200);
    const logoutCookie = logoutRes.headers.get('set-cookie') || '';
    expect(logoutCookie).toContain('pwd_master_session=');
    expect(logoutCookie).not.toContain('pwd_session=');
    const logoutBody = (await logoutRes.json()) as {
      ok: boolean;
      tokenType: string;
      revoked: boolean;
    };
    expect(logoutBody.ok).toBe(true);
    expect(logoutBody.tokenType).toBe('master');
    expect(logoutBody.revoked).toBe(true);

    const revokedMe = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${revokedToken}` },
    });
    expect(revokedMe.status).toBe(401);

    // Re-login para testes de rotas protegidas
    const loginAgain = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: TEST_OWNER_EMAIL,
        password: TEST_OWNER_PASSWORD,
      }),
    });
    expect(loginAgain.status).toBe(200);
    const again = (await loginAgain.json()) as { session: { token: string } };
    token = again.session.token;

    const auditRes = await fetch(`${baseUrl}/audit?resource=auth&limit=100`, {
      headers: { 'x-master-key': TEST_API_KEY },
    });
    const auditBody = (await auditRes.json()) as {
      audit: Array<{ action: string }>;
    };
    const actions = auditBody.audit.map((row) => row.action);
    expect(actions).toContain('LOGIN_REFRESH');
    expect(actions).toContain('LOGIN_LOGOUT');
  });

  it('rotas REST Master autenticadas', async () => {
    const paths = [
      '/dashboard',
      '/summary',
      '/logs',
      '/health',
      '/tenants',
      '/licenses',
      '/subscriptions',
      '/billing',
      '/payments',
      '/invoices',
      '/pix',
      '/deployments',
      '/hybrid',
      '/system',
      '/audit',
      '/users',
      '/charges',
      '/finance',
      '/admin',
      '/plans',
      '/auth/me',
      '/openapi.json',
    ];
    for (const path of paths) {
      const headers: Record<string, string> = {};
      if (path !== '/openapi.json') {
        headers.authorization = `Bearer ${token}`;
      }
      const res = await fetch(`${baseUrl}${path}`, { headers });
      expect(res.status, path).toBe(200);
      const body = (await res.json()) as { ok?: boolean; openapi?: string };
      if (path === '/openapi.json') {
        expect(body.openapi).toBe('3.0.3');
      } else if (path !== '/auth/me') {
        expect(body.ok, path).toBe(true);
      }
    }
  });

  it('contrato de vigência HTTP: dashboard/tenants/licenses', async () => {
    // Autossuficiente: não depende da ordem dos outros its.
    if (!token) {
      const login = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: TEST_OWNER_EMAIL,
          password: TEST_OWNER_PASSWORD,
        }),
      });
      expect(login.status).toBe(200);
      const body = (await login.json()) as { session: { token: string } };
      token = body.session.token;
    }
    const { validateMasterEndpointResponse } = await import(
      '../contract/index.js'
    );
    const headers = { authorization: `Bearer ${token}` };
    const checks: Array<{
      path: string;
      endpoint:
        | 'GET /api/master/dashboard'
        | 'GET /api/master/tenants'
        | 'GET /api/master/licenses';
    }> = [
      { path: '/dashboard', endpoint: 'GET /api/master/dashboard' },
      { path: '/tenants', endpoint: 'GET /api/master/tenants' },
      { path: '/licenses', endpoint: 'GET /api/master/licenses' },
    ];
    for (const check of checks) {
      const res = await fetch(`${baseUrl}${check.path}`, { headers });
      expect(res.status, check.path).toBe(200);
      const body = await res.json();
      const report = validateMasterEndpointResponse(check.endpoint, body);
      expect(report.violations, JSON.stringify(report.violations, null, 2)).toEqual([]);
      expect(report.ok).toBe(true);
    }
  });

  it('ADMIN gerencia operação, mas não cria outro OWNER', async () => {
    const createAdmin = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        email: 'admin-hierarchy@master.test',
        name: 'Admin Hierarchy',
        password: 'admin-pass-1234',
        role: 'MASTER_ADMIN',
      }),
    });
    expect(createAdmin.status).toBe(201);

    const adminLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin-hierarchy@master.test',
        password: 'admin-pass-1234',
      }),
    });
    expect(adminLogin.status).toBe(200);
    const adminBody = (await adminLogin.json()) as { session: { token: string } };

    const createOwner = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminBody.session.token}`,
      },
      body: JSON.stringify({
        email: 'forbidden-owner@master.test',
        name: 'Forbidden Owner',
        password: 'owner-pass-1234',
        role: 'MASTER_OWNER',
      }),
    });
    expect(createOwner.status).toBe(403);
    expect(await createOwner.json()).toMatchObject({
      code: 'MASTER_FORBIDDEN_POLICY',
    });

    const createSupport = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminBody.session.token}`,
      },
      body: JSON.stringify({
        email: 'support-hierarchy@master.test',
        name: 'Support Hierarchy',
        password: 'support-pass-1234',
        role: 'MASTER_SUPPORT',
      }),
    });
    expect(createSupport.status).toBe(201);
    const supportBody = (await createSupport.json()) as {
      user: { id: string; role: string; active: boolean };
    };

    const promoteSupport = await fetch(`${baseUrl}/users/${supportBody.user.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminBody.session.token}`,
      },
      body: JSON.stringify({
        role: 'MASTER_FINANCE',
      }),
    });
    expect(promoteSupport.status).toBe(200);

    const resetSupportPassword = await fetch(
      `${baseUrl}/users/${supportBody.user.id}/reset-password`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${adminBody.session.token}`,
        },
        body: JSON.stringify({ newPassword: 'support-new-pass-456' }),
      },
    );
    expect(resetSupportPassword.status).toBe(200);

    const blockSupport = await fetch(`${baseUrl}/users/${supportBody.user.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminBody.session.token}`,
      },
      body: JSON.stringify({ active: false }),
    });
    expect(blockSupport.status).toBe(200);
  });

  it('X-Master-Key autentica sem JWT de empresa', async () => {
    const res = await fetch(`${baseUrl}/system`, {
      headers: { 'x-master-key': TEST_API_KEY },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const usersRes = await fetch(`${baseUrl}/users`, {
      headers: { 'x-master-key': TEST_API_KEY },
    });
    expect(usersRes.status).toBe(403);
  });
});
