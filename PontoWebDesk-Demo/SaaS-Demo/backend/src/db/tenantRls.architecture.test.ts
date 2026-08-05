// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const connectMock = vi.fn();
const releaseMock = vi.fn();
const endMock = vi.fn();
const onMock = vi.fn();

vi.mock('pg', () => {
  class Pool {
    query = queryMock;
    connect = connectMock;
    end = endMock;
    on = onMock;
  }
  return { Pool };
});

vi.mock('./pgConfig.js', () => ({
  buildPgPoolConfig: () => ({
    connectionString: 'postgres://test',
  }),
}));

vi.mock('../logger/observabilityConsole.js', () => ({
  observabilityConsole: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('../logger/logger.context.js', () => ({
  getRequestContext: () => ({
    companyId: 'company-a',
    userId: 'user-a',
    role: 'admin',
  }),
  updateRequestContext: vi.fn(),
}));

describe('db pool RLS architecture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.VPS_RLS_ENFORCED = 'true';
  });

  it('pool.query aplica set_config tenant na mesma transação da consulta', async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(String(sql).replace(/\s+/g, ' ').trim());
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }),
      release: releaseMock,
    };
    connectMock.mockResolvedValue(client);

    const { pool } = await import('./index.js');
    await pool.query('select id from public.users where company_id::text = $1', ['company-a']);

    expect(statements[0]).toMatch(/^BEGIN$/i);
    expect(statements.some((sql) => sql.includes("set_config('app.rls_enforced'"))).toBe(true);
    expect(statements.some((sql) => sql.includes("set_config('app.current_company_id'"))).toBe(
      true,
    );
    expect(statements.some((sql) => /select id from public\.users/i.test(sql))).toBe(true);
    expect(statements.at(-1)).toMatch(/^COMMIT$/i);
    expect(releaseMock).toHaveBeenCalled();

    const configIdx = statements.findIndex((sql) =>
      sql.includes("set_config('app.current_company_id'"),
    );
    const userIdx = statements.findIndex((sql) => /select id from public\.users/i.test(sql));
    expect(configIdx).toBeGreaterThan(0);
    expect(userIdx).toBeGreaterThan(configIdx);
  });

  it('queryTrustedBootstrap força app.rls_enforced=false para login pré-companyId', async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        statements.push(String(sql).replace(/\s+/g, ' ').trim());
        if (String(sql).includes('set_config')) {
          expect(params?.[0]).toBe('false');
        }
        return { rows: [], rowCount: 0 };
      }),
      release: releaseMock,
    };
    connectMock.mockResolvedValue(client);

    const { pool } = await import('./index.js');
    await pool.queryTrustedBootstrap(
      'select id from public.users where lower(trim(email)) = $1 limit 1',
      ['admin@test.com'],
    );

    expect(statements.some((sql) => sql.includes("set_config('app.rls_enforced'"))).toBe(true);
    expect(statements.at(-1)).toMatch(/^COMMIT$/i);
  });

  it('pool.connect reaplica tenant RLS automaticamente após BEGIN', async () => {
    const statements: string[] = [];
    const rawClient = {
      query: vi.fn(async (sql: string) => {
        statements.push(String(sql).replace(/\s+/g, ' ').trim());
        return { rows: [], rowCount: 0 };
      }),
      release: releaseMock,
    };
    connectMock.mockResolvedValue(rawClient);

    const { pool } = await import('./index.js');
    const client = await pool.connect();
    await client.query('begin');
    await client.query('select 1 from public.time_records limit 1');

    expect(statements[0]).toMatch(/^begin$/i);
    expect(statements.some((sql) => sql.includes("set_config('app.current_company_id'"))).toBe(
      true,
    );
    const beginIdx = 0;
    const configIdx = statements.findIndex((sql) =>
      sql.includes("set_config('app.current_company_id'"),
    );
    const selectIdx = statements.findIndex((sql) =>
      /select 1 from public\.time_records/i.test(sql),
    );
    expect(configIdx).toBeGreaterThan(beginIdx);
    expect(selectIdx).toBeGreaterThan(configIdx);
  });
});
