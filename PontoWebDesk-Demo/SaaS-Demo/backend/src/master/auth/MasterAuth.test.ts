// @vitest-environment node
/**
 * Testes do sistema de autenticação Master (enterprise).
 * Isolado do auth operacional (JWT_SECRET / pwd_session).
 */
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it } from 'vitest';
import { MasterAuthService } from './MasterAuthService.js';
import { MasterLoginError } from '../errors.js';
import {
  MASTER_AUTH_COOKIE,
  MASTER_REFRESH_COOKIE,
  decodeMasterJWT,
  signMasterToken,
  verifyMasterToken,
} from './MasterJWT.js';
import {
  MASTER_ROLE_PERMISSIONS,
  permissionsForRole,
  roleHasPermission,
} from './MasterPermission.js';
import {
  canExecuteTenantAction,
  canManageMasterRole,
  canManageMasterUser,
} from './MasterAuthorizationPolicy.js';
import { MASTER_ROLES } from './masterAuth.types.js';
import { AUTH_COOKIE_NAME } from '../../security/authCookies.js';
import { getMasterMaxSessions } from './masterSessionConfig.js';

describe('MasterAuth', () => {
  beforeEach(() => {
    process.env.MASTER_JWT_SECRET = 'master-auth-unit-secret-with-32-bytes';
    process.env.MASTER_MAX_SESSIONS = '5';
    delete process.env.JWT_SECRET;
    for (const key of [
      'MASTER_OWNER_EMAIL',
      'MASTER_OWNER_PASSWORD',
      'MASTER_OWNER_NAME',
      'MASTER_OWNER_1_EMAIL',
      'MASTER_OWNER_1_PASSWORD',
      'MASTER_OWNER_1_NAME',
      'MASTER_OWNER_1_IS_FOUNDER',
      'MASTER_OWNER_2_EMAIL',
      'MASTER_OWNER_2_PASSWORD',
      'MASTER_OWNER_2_NAME',
      'MASTER_OWNER_2_IS_FOUNDER',
      'MASTER_FOUNDER_USER_IDS',
    ]) {
      delete process.env[key];
    }
  });

  it('MASTER_ROLES inclui MASTER_AUDITOR', () => {
    expect(MASTER_ROLES).toContain('MASTER_OWNER');
    expect(MASTER_ROLES).toContain('MASTER_ADMIN');
    expect(MASTER_ROLES).toContain('MASTER_SUPPORT');
    expect(MASTER_ROLES).toContain('MASTER_FINANCE');
    expect(MASTER_ROLES).toContain('MASTER_AUDITOR');
  });

  it('MasterPermission: AUDITOR é somente leitura', () => {
    expect(roleHasPermission('MASTER_AUDITOR', 'audit:read')).toBe(true);
    expect(roleHasPermission('MASTER_AUDITOR', 'tenants:write')).toBe(false);
    expect(roleHasPermission('MASTER_AUDITOR', 'users:write')).toBe(false);
    expect(roleHasPermission('MASTER_AUDITOR', 'payments:write')).toBe(false);
    expect(MASTER_ROLE_PERMISSIONS.MASTER_AUDITOR).toContain('dashboard:read');
  });

  it('hierarquia separa OWNER de ADMIN na gestão de Owners', () => {
    expect(roleHasPermission('MASTER_OWNER', 'owners:write')).toBe(true);
    expect(roleHasPermission('MASTER_ADMIN', 'owners:write')).toBe(false);
    expect(canManageMasterRole('MASTER_OWNER', 'MASTER_OWNER')).toBe(true);
    expect(canManageMasterRole('MASTER_ADMIN', 'MASTER_OWNER')).toBe(false);
    expect(canManageMasterRole('MASTER_ADMIN', 'MASTER_SUPPORT')).toBe(true);
    expect(
      canManageMasterUser('MASTER_ADMIN', 'MASTER_OWNER', 'MASTER_SUPPORT'),
    ).toBe(false);
  });

  it('SUPPORT só recebe suporte técnico e impersonação reservada', () => {
    expect(roleHasPermission('MASTER_SUPPORT', 'tenants:impersonate')).toBe(true);
    expect(roleHasPermission('MASTER_SUPPORT', 'licenses:write')).toBe(false);
    expect(roleHasPermission('MASTER_SUPPORT', 'payments:write')).toBe(false);
    expect(roleHasPermission('MASTER_SUPPORT', 'users:read')).toBe(false);
  });

  it('FINANCE gerencia licenças, cobranças e somente ações de bloqueio', () => {
    expect(roleHasPermission('MASTER_FINANCE', 'licenses:write')).toBe(true);
    expect(roleHasPermission('MASTER_FINANCE', 'payments:write')).toBe(true);
    expect(canExecuteTenantAction('MASTER_FINANCE', 'block')).toBe(true);
    expect(canExecuteTenantAction('MASTER_FINANCE', 'unblock')).toBe(true);
    expect(canExecuteTenantAction('MASTER_FINANCE', 'suspend')).toBe(true);
    expect(canExecuteTenantAction('MASTER_FINANCE', 'cancel')).toBe(false);
    expect(canExecuteTenantAction('MASTER_FINANCE', 'activate')).toBe(false);
  });

  it('MasterUser login emite MasterSession + MasterJWT enterprise', async () => {
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
      device: 'vitest',
      ip: '127.0.0.1',
    });
    expect(session.tokenType).toBe('master');
    expect(session.role).toBe('MASTER_OWNER');
    expect(session.refreshToken).toMatch(/^mrt_/);
    expect(session.sessionId).toMatch(/^msid_/);
    expect(session.jti).toMatch(/^mjti_/);
    expect(session.permissions).toEqual([...permissionsForRole('MASTER_OWNER')]);
    const payload = decodeMasterJWT(session.token);
    expect(payload?.typ).toBe('master');
    expect(payload?.role).toBe('MASTER_OWNER');
    expect(payload?.jti).toBe(session.jti);
    expect(payload?.sessionId).toBe(session.sessionId);
    expect(payload?.issuedAt).toBeTruthy();
    expect(payload?.lastActivity).toBeTruthy();
    expect(payload?.device).toBe('vitest');
    expect(payload?.ip).toBe('127.0.0.1');
    expect(verifyMasterToken(session.token)?.userId).toBe(session.userId);
    expect(await auth.assertActiveAccess(session.token)).toBeTruthy();
  });

  it('rehidrata sessão quando o store perde o registro (restart in-memory)', async () => {
    const auth = MasterAuthService.createInMemory();
    await auth.createUser({
      email: 'rehydrate@master.test',
      name: 'Reh',
      password: 'secret1234',
      role: 'MASTER_OWNER',
    });
    const session = await auth.login({
      email: 'rehydrate@master.test',
      password: 'secret1234',
    });
    // Simula perda do store (reinício do processo).
    await auth.getSessionStore().delete(session.sessionId);
    expect(await auth.getSessionStore().findById(session.sessionId)).toBeNull();

    const restored = await auth.assertActiveAccess(session.token);
    expect(restored?.userId).toBe(session.userId);
    expect(restored?.sessionId).toBe(session.sessionId);
    expect(await auth.getSessionStore().findById(session.sessionId)).toBeTruthy();
  });

  it('credenciais inválidas não autenticam', async () => {
    const auth = MasterAuthService.createInMemory();
    await auth.createUser({
      email: 'a@master.test',
      name: 'A',
      password: 'secret1234',
      role: 'MASTER_SUPPORT',
    });
    const wrongPassword = await auth
      .login({ email: 'a@master.test', password: 'wrong-password' })
      .catch((error: unknown) => error);
    expect(wrongPassword).toBeInstanceOf(MasterLoginError);
    expect((wrongPassword as MasterLoginError).reason).toBe('invalid_password');

    const unknown = await auth
      .login({ email: 'unknown@master.test', password: 'wrong-password' })
      .catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(MasterLoginError);
    expect((unknown as MasterLoginError).reason).toBe('unknown_account');

    const user = (await auth.listUsers()).find((row) => row.email === 'a@master.test');
    expect(user).toBeTruthy();
    await auth.updateUser(user!.id, { active: false });
    const blocked = await auth
      .login({ email: 'a@master.test', password: 'secret1234' })
      .catch((error: unknown) => error);
    expect(blocked).toBeInstanceOf(MasterLoginError);
    expect((blocked as MasterLoginError).reason).toBe('blocked_account');
  });

  it('refresh rotaciona refresh token e invalida o anterior', async () => {
    const auth = MasterAuthService.createInMemory();
    await auth.createUser({
      email: 'fin@master.test',
      name: 'Fin',
      password: 'secret1234',
      role: 'MASTER_FINANCE',
    });
    const first = await auth.login({
      email: 'fin@master.test',
      password: 'secret1234',
    });
    const second = await auth.refresh({ refreshToken: first.refreshToken });
    expect(second.tokenType).toBe('master');
    expect(second.role).toBe('MASTER_FINANCE');
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.jti).not.toBe(first.jti);
    expect(verifyMasterToken(second.token)?.email).toBe('fin@master.test');
    expect(await auth.assertActiveAccess(first.token)).toBeNull();
    expect(await auth.assertActiveAccess(second.token)).toBeTruthy();

    await expect(auth.refresh({ refreshToken: first.refreshToken })).rejects.toThrow(
      /master_refresh_reuse|invalid_master_token/,
    );
  });

  it('refresh via access token (compat) renova sessão', async () => {
    const auth = MasterAuthService.createInMemory();
    await auth.createUser({
      email: 'fin2@master.test',
      name: 'Fin2',
      password: 'secret1234',
      role: 'MASTER_FINANCE',
    });
    const first = await auth.login({
      email: 'fin2@master.test',
      password: 'secret1234',
    });
    const second = await auth.refresh(first.token);
    expect(second.token).toBeTruthy();
    expect(second.sessionId).toBe(first.sessionId);
  });

  it('refresh rejeita token inválido', async () => {
    const auth = MasterAuthService.createInMemory();
    await expect(auth.refresh('not-a-jwt')).rejects.toThrow(/invalid_master_token/);
  });

  it('logout revoga JWT e refresh', async () => {
    const auth = MasterAuthService.createInMemory();
    await auth.createUser({
      email: 'out@master.test',
      name: 'Out',
      password: 'secret1234',
      role: 'MASTER_ADMIN',
    });
    const session = await auth.login({
      email: 'out@master.test',
      password: 'secret1234',
    });
    const result = await auth.logout({ token: session.token });
    expect(result).toMatchObject({
      ok: true,
      tokenType: 'master',
      revoked: true,
      sessionId: session.sessionId,
    });
    expect(await auth.assertActiveAccess(session.token)).toBeNull();
    await expect(auth.refresh({ refreshToken: session.refreshToken })).rejects.toThrow();
    expect(MASTER_AUTH_COOKIE).toBe('pwd_master_session');
    expect(MASTER_REFRESH_COOKIE).toBe('pwd_master_refresh');
    expect(AUTH_COOKIE_NAME).toBe('pwd_session');
    expect(MASTER_AUTH_COOKIE).not.toBe(AUTH_COOKIE_NAME);
    expect(MASTER_REFRESH_COOKIE).not.toBe(AUTH_COOKIE_NAME);
  });

  it('limite de sessões simultâneas revoga as mais antigas', async () => {
    process.env.MASTER_MAX_SESSIONS = '2';
    expect(getMasterMaxSessions()).toBe(2);
    const auth = MasterAuthService.createInMemory();
    await auth.createUser({
      email: 'lim@master.test',
      name: 'Lim',
      password: 'secret1234',
      role: 'MASTER_OWNER',
    });
    const s1 = await auth.login({ email: 'lim@master.test', password: 'secret1234' });
    const s2 = await auth.login({ email: 'lim@master.test', password: 'secret1234' });
    const s3 = await auth.login({ email: 'lim@master.test', password: 'secret1234' });
    expect(await auth.assertActiveAccess(s1.token)).toBeNull();
    expect(await auth.assertActiveAccess(s2.token)).toBeTruthy();
    expect(await auth.assertActiveAccess(s3.token)).toBeTruthy();
  });

  it('MasterJWT não usa JWT_SECRET das empresas', () => {
    process.env.MASTER_JWT_SECRET = 'only-master-secret-with-at-least-32-bytes';
    process.env.JWT_SECRET = 'company-secret-must-not-work';
    const { token } = signMasterToken({
      userId: 'mu_1',
      email: 'x@y.z',
      name: 'X',
      role: 'MASTER_AUDITOR',
      sessionId: 'msid_test',
    });
    expect(verifyMasterToken(token)?.role).toBe('MASTER_AUDITOR');
    expect(verifyMasterToken(token)?.sessionId).toBe('msid_test');

    const companyToken = jwt.sign(
      {
        typ: 'master',
        sub: 'mu_1',
        email: 'x@y.z',
        name: 'X',
        role: 'MASTER_AUDITOR',
        jti: 'mjti_x',
        sessionId: 'msid_x',
        issuedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      },
      'company-secret-must-not-work',
      { audience: 'pontowebdesk-master', issuer: 'pontowebdesk-master-auth' },
    );
    expect(verifyMasterToken(companyToken)).toBeNull();
  });

  it('MasterJWT rejeita segredo ausente ou inseguro em produção', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousMasterSecret = process.env.MASTER_JWT_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.MASTER_JWT_SECRET;
      expect(() =>
        signMasterToken({
          userId: 'mu_1',
          email: 'x@y.z',
          name: 'X',
          role: 'MASTER_AUDITOR',
          sessionId: 'msid_1',
        }),
      ).toThrow(/MASTER_JWT_SECRET obrigatório/);

      process.env.MASTER_JWT_SECRET = 'master-dev-secret-change-me';
      expect(() =>
        signMasterToken({
          userId: 'mu_1',
          email: 'x@y.z',
          name: 'X',
          role: 'MASTER_AUDITOR',
          sessionId: 'msid_1',
        }),
      ).toThrow(/MASTER_JWT_SECRET inseguro/);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousMasterSecret === undefined) delete process.env.MASTER_JWT_SECRET;
      else process.env.MASTER_JWT_SECRET = previousMasterSecret;
    }
  });

  it('cria usuário MASTER_AUDITOR', async () => {
    const auth = MasterAuthService.createInMemory();
    const user = await auth.createUser({
      email: 'auditor@master.test',
      name: 'Auditor',
      password: 'secret1234',
      role: 'MASTER_AUDITOR',
    });
    expect(user.role).toBe('MASTER_AUDITOR');
  });

  it('cria dois Owners com credenciais e sessões independentes', async () => {
    process.env.MASTER_OWNER_1_EMAIL = 'paulo@master.test';
    process.env.MASTER_OWNER_1_PASSWORD = 'senha-paulo-123';
    process.env.MASTER_OWNER_1_NAME = 'Paulo';
    process.env.MASTER_OWNER_2_EMAIL = 'tio@master.test';
    process.env.MASTER_OWNER_2_PASSWORD = 'senha-tio-456';
    process.env.MASTER_OWNER_2_NAME = 'Tio';

    const auth = MasterAuthService.createInMemory();
    const owners = await auth.ensureBootstrapOwners();
    expect(owners).toHaveLength(2);
    expect(owners.map((user) => user.role)).toEqual([
      'MASTER_OWNER',
      'MASTER_OWNER',
    ]);
    expect(await auth.ensureBootstrapOwners()).toHaveLength(2);
    expect(await auth.listUsers()).toHaveLength(2);

    const paulo = await auth.login({
      email: 'paulo@master.test',
      password: 'senha-paulo-123',
    });
    const tio = await auth.login({
      email: 'tio@master.test',
      password: 'senha-tio-456',
    });

    expect(paulo.userId).not.toBe(tio.userId);
    expect(paulo.token).not.toBe(tio.token);
    expect(paulo.refreshToken).not.toBe(tio.refreshToken);
    expect(paulo.sessionId).not.toBe(tio.sessionId);
    expect(verifyMasterToken(paulo.token)?.userId).toBe(paulo.userId);
    expect(verifyMasterToken(tio.token)?.userId).toBe(tio.userId);
  });

  it('rejeita senha compartilhada entre Owners no bootstrap', async () => {
    process.env.MASTER_OWNER_1_EMAIL = 'owner1@master.test';
    process.env.MASTER_OWNER_1_PASSWORD = 'same-password';
    process.env.MASTER_OWNER_2_EMAIL = 'owner2@master.test';
    process.env.MASTER_OWNER_2_PASSWORD = 'same-password';

    const auth = MasterAuthService.createInMemory();
    await expect(auth.ensureBootstrapOwners()).rejects.toThrow(
      /must use different passwords/,
    );
    expect(await auth.listUsers()).toHaveLength(0);
  });

  it('troca de role revoga todas as sessões do usuário', async () => {
    const auth = MasterAuthService.createInMemory();
    const user = await auth.createUser({
      email: 'managed@master.test',
      name: 'Managed',
      password: 'secret1234',
      role: 'MASTER_SUPPORT',
    });
    const session = await auth.login({
      email: user.email,
      password: 'secret1234',
    });

    const updated = await auth.updateUser(user.id, { role: 'MASTER_FINANCE' });
    expect(updated.role).toBe('MASTER_FINANCE');
    expect(await auth.assertActiveAccess(session.token)).toBeNull();
  });

  it('redefinição administrativa troca senha e revoga sessões', async () => {
    const auth = MasterAuthService.createInMemory();
    const user = await auth.createUser({
      email: 'password-managed@master.test',
      name: 'Password Managed',
      password: 'old-secret-123',
      role: 'MASTER_ADMIN',
    });
    const session = await auth.login({
      email: user.email,
      password: 'old-secret-123',
    });

    await auth.resetUserPassword(user.id, 'new-secret-456');
    expect(await auth.assertActiveAccess(session.token)).toBeNull();
    await expect(
      auth.login({ email: user.email, password: 'old-secret-123' }),
    ).rejects.toThrow(/invalid_master_credentials/);
    await expect(
      auth.login({ email: user.email, password: 'new-secret-456' }),
    ).resolves.toMatchObject({ userId: user.id });
  });

  it('não permite desativar ou rebaixar o último Owner ativo', async () => {
    const auth = MasterAuthService.createInMemory();
    const onlyOwner = await auth.createUser({
      email: 'only-owner@master.test',
      name: 'Only Owner',
      password: 'secret1234',
      role: 'MASTER_OWNER',
    });

    await expect(auth.updateUser(onlyOwner.id, { active: false })).rejects.toThrow(
      /last active Master Owner/,
    );
    await expect(
      auth.updateUser(onlyOwner.id, { role: 'MASTER_ADMIN' }),
    ).rejects.toThrow(/last active Master Owner/);
  });

  it('bootstrap não reativa nem bloqueia login global após decisão administrativa', async () => {
    process.env.MASTER_OWNER_1_EMAIL = 'bootstrap-owner@master.test';
    process.env.MASTER_OWNER_1_PASSWORD = 'bootstrap-secret-123';
    // Owner comum (não Founder) para validar bloqueio administrativo sem conflitar com proteção Founder.
    process.env.MASTER_OWNER_1_IS_FOUNDER = 'false';
    const auth = MasterAuthService.createInMemory();
    const [bootstrapOwner] = await auth.ensureBootstrapOwners();
    expect(bootstrapOwner.isFounder).toBe(false);
    await auth.createUser({
      email: 'second-owner@master.test',
      name: 'Second Owner',
      password: 'second-secret-456',
      role: 'MASTER_OWNER',
    });

    await auth.updateUser(bootstrapOwner.id, { active: false });
    const [existing] = await auth.ensureBootstrapOwners();
    expect(existing.active).toBe(false);
    expect((await auth.listUsers()).filter((user) => user.active)).toHaveLength(1);
  });

  it('bootstrap marca slot 1 como Founder por padrão e impede bloqueio', async () => {
    process.env.MASTER_OWNER_1_EMAIL = 'founder-owner@master.test';
    process.env.MASTER_OWNER_1_PASSWORD = 'founder-secret-123';
    const auth = MasterAuthService.createInMemory();
    const [founder] = await auth.ensureBootstrapOwners();
    expect(founder.isFounder).toBe(true);
    await auth.createUser({
      email: 'other-owner@master.test',
      name: 'Other Owner',
      password: 'other-secret-456',
      role: 'MASTER_OWNER',
    });
    await expect(auth.updateUser(founder.id, { active: false })).rejects.toMatchObject({
      action: 'FOUNDER_BLOCK_DENIED',
    });
    expect((await auth.getUser(founder.id)).active).toBe(true);
  });
});
