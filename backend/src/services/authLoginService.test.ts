// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';

const poolQuery = vi.fn();
const readCompanySessionGate = vi.fn();

vi.mock('../db/index.js', () => ({
  pool: {
    query: (...args: unknown[]) => poolQuery(...args),
    queryTrustedBootstrap: (...args: unknown[]) => poolQuery(...args),
  },
}));

vi.mock('../db/schemaColumns.js', () => ({
  tableHasColumn: vi.fn().mockResolvedValue(false),
}));

vi.mock('../services/tokenRevocationService.js', () => ({
  newTokenJti: vi.fn(() => 'jti-1'),
}));

vi.mock('../master/commercial/companySessionRevocation.js', () => ({
  readCompanySessionGate: (...args: unknown[]) => readCompanySessionGate(...args),
  isCommercialGateUnavailableError: (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'COMMERCIAL_GATE_UNAVAILABLE',
}));

import { authenticateLogin } from './authLoginService.js';

describe('authenticateLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-with-enough-length-for-jwt';
    readCompanySessionGate.mockResolvedValue({
      commercialBlocked: false,
      commercialBlockReason: null,
      companySessionVersion: 0,
    });
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.columns')) return { rowCount: 0, rows: [] };
      if (sql.includes('from users')) return { rows: [] };
      if (sql.includes('from employees')) return { rows: [] };
      return { rows: [] };
    });
  });

  it('retorna mensagem unificada quando usuário não existe', async () => {
    const result = await authenticateLogin({ identifier: 'missing@test.com', password: 'SenhaForte#1234' });

    expect(result).toEqual({ status: 401, error: 'Credenciais inválidas' });
  });

  it('retorna mensagem unificada quando senha é inválida', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.columns')) return { rowCount: 0, rows: [] };
      if (sql.includes('from users')) {
        return {
          rows: [
            {
              id: 'user-1',
              email: 'user@test.com',
              nome: 'User',
              company_id: 'company-1',
              role: 'employee',
              cargo: null,
              department_id: null,
              schedule_id: null,
              shift_id: null,
              phone: null,
              avatar: null,
              preferences: {},
              password_hash: '$2a$12$K8xYvZ8YvZ8YvZ8YvZ8YuO8YvZ8YvZ8YvZ8YvZ8YvZ8YvZ8YvZ8Yu',
              status: 'active',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await authenticateLogin({ identifier: 'user@test.com', password: 'wrong-password' });

    expect(result).toEqual({ status: 401, error: 'Credenciais inválidas' });
  });

  it('impede login quando a empresa foi bloqueada pelo Master', async () => {
    const passwordHash = bcrypt.hashSync('SenhaForte#1234', 4);
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.columns')) return { rowCount: 0, rows: [] };
      if (sql.includes('from users')) {
        return {
          rows: [{
            id: 'user-1',
            email: 'user@test.com',
            nome: 'User',
            company_id: 'company-1',
            role: 'admin',
            password_hash: passwordHash,
            status: 'active',
          }],
        };
      }
      return { rows: [] };
    });
    readCompanySessionGate.mockResolvedValue({
      commercialBlocked: true,
      commercialBlockReason: 'tenant_blocked_by_master',
      companySessionVersion: 2,
    });

    const result = await authenticateLogin({
      identifier: 'user@test.com',
      password: 'SenhaForte#1234',
    });

    expect(result).toEqual({
      status: 403,
      error: 'Acesso bloqueado pelo Painel Master. Entre em contato com o suporte comercial.',
      code: 'COMMERCIAL_BLOCKED_BY_MASTER',
    });
    expect(result).not.toHaveProperty('token');
  });

  it('empresa com licença expirada não mascara como Credenciais inválidas', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.columns')) return { rowCount: 0, rows: [] };
      if (sql.includes('from users')) {
        return {
          rows: [{
            id: 'user-1',
            email: 'admin@test.com',
            nome: 'Admin',
            company_id: 'company-1',
            role: 'admin',
            password_hash: bcrypt.hashSync('qualquer', 4),
            status: 'active',
          }],
        };
      }
      return { rows: [] };
    });
    readCompanySessionGate.mockResolvedValue({
      commercialBlocked: true,
      commercialBlockReason: 'license_expired_by_master',
      companySessionVersion: 3,
    });

    const result = await authenticateLogin({
      identifier: 'admin@test.com',
      password: 'senha-errada',
    });

    expect(result).toEqual({
      status: 403,
      error: 'Licença expirada. Entre em contato com o suporte comercial para renovar o acesso.',
      code: 'COMMERCIAL_BLOCKED_BY_MASTER',
    });
    expect(result).not.toHaveProperty('token');
  });

  it('não cria sessão quando o gate comercial está indisponível', async () => {
    const passwordHash = bcrypt.hashSync('SenhaForte#1234', 4);
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.columns')) return { rowCount: 0, rows: [] };
      if (sql.includes('from users')) {
        return {
          rows: [{
            id: 'user-1',
            email: 'user@test.com',
            nome: 'User',
            company_id: 'company-1',
            role: 'admin',
            password_hash: passwordHash,
            status: 'active',
          }],
        };
      }
      return { rows: [] };
    });
    readCompanySessionGate.mockRejectedValue(
      Object.assign(new Error('gate unavailable'), {
        code: 'COMMERCIAL_GATE_UNAVAILABLE',
      }),
    );

    await expect(authenticateLogin({
      identifier: 'user@test.com',
      password: 'SenhaForte#1234',
    })).resolves.toMatchObject({
      status: 503,
      error: 'Não foi possível validar a situação comercial da empresa.',
      code: 'COMMERCIAL_GATE_UNAVAILABLE',
      detail: 'gate unavailable',
    });
  });
});
