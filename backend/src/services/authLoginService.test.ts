import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolQuery = vi.fn();

vi.mock('../db/index.js', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}));

vi.mock('../db/schemaColumns.js', () => ({
  tableHasColumn: vi.fn().mockResolvedValue(false),
}));

vi.mock('../services/tokenRevocationService.js', () => ({
  newTokenJti: vi.fn(() => 'jti-1'),
}));

import { authenticateLogin } from './authLoginService.js';

describe('authenticateLogin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret-with-enough-length-for-jwt';
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
});
