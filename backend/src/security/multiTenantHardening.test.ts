// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const poolQuery = vi.fn();
const verifyRepAgentTokenVps = vi.fn();
const fetchRepDeviceCompanyId = vi.fn();
const resolveCallerFromDb = vi.fn();
const tableHasColumn = vi.fn();

vi.mock('../db/index.js', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}));

vi.mock('../services/repAgentAuthService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/repAgentAuthService.js')>();
  return {
    ...actual,
    verifyRepAgentTokenVps: (...args: unknown[]) => verifyRepAgentTokenVps(...args),
    fetchRepDeviceCompanyId: (...args: unknown[]) => fetchRepDeviceCompanyId(...args),
  };
});

vi.mock('../services/callerContextService.js', () => ({
  resolveCallerFromDb: (...args: unknown[]) => resolveCallerFromDb(...args),
}));

vi.mock('../db/schemaColumns.js', () => ({
  tableHasColumn: (...args: unknown[]) => tableHasColumn(...args),
}));

vi.mock('../services/repUserMatch.service.js', () => ({
  resolveUserForRepPunch: vi.fn().mockResolvedValue({ userId: null, strategy: 'none' }),
}));

vi.mock('../services/repPostIngest.service.js', () => ({
  enqueueRepTimesheetRecalcJobs: vi.fn(),
  isRepIngestMigrationError: vi.fn().mockReturnValue(false),
  logRepPipelineDbDiagnostics: vi.fn(),
  logRepPipelineTelemetry: vi.fn(),
  processRepCalcDayJobsImmediate: vi.fn().mockResolvedValue(0),
  promotePendingRepLogsAfterBatch: vi.fn().mockResolvedValue({ promoted: [] }),
}));

vi.mock('../services/repRpcProxy.service.js', () => ({
  executeRepRpcProxy: vi.fn(),
  repRpcExistsInDatabase: vi.fn(),
}));

import { repPunchesController } from '../controllers/repController.js';
import { authenticatedGlobalSettingsController, insertDataController } from '../controllers/dataController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { tableHasTenantScope } from '../utils/dataTablePolicy.js';

vi.mock('../utils/dataRowSchema.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/dataRowSchema.js')>();
  return {
    ...actual,
    filterRowToTableSchema: vi.fn(async (_table: string, row: Record<string, unknown>) => row),
    getReadableTableColumns: vi.fn(async () => ['id', 'user_id', 'key', 'value']),
    getTableColumnTypes: vi.fn(async () => new Map()),
    applyTenantToRowAsync: vi.fn(async (_t: string, row: Record<string, unknown>) => row),
  };
});

function captureRes(): { res: Response; status: () => number; body: () => Record<string, unknown> } {
  let statusCode = 200;
  let payload: Record<string, unknown> = {};
  const res = {
    status(code: number) {
      statusCode = code;
      return {
        json(body: Record<string, unknown>) {
          payload = body;
        },
        send() {},
      };
    },
    json(body: Record<string, unknown>) {
      payload = body;
    },
  } as unknown as Response;
  return {
    res,
    status: () => statusCode,
    body: () => payload,
  };
}

describe('multi-tenant hardening — casos obrigatórios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
    tableHasColumn.mockResolvedValue(true);
  });

  it('TESTE 1 — tenant A com device B em punches retorna 403 quando device inativo', async () => {
    verifyRepAgentTokenVps.mockResolvedValue({ ok: false, code: 'DEVICE_INACTIVE' });
    fetchRepDeviceCompanyId.mockResolvedValue('company-b');

    const { res, status, body } = captureRes();
    await repPunchesController(
      {
        headers: { authorization: 'Bearer bridge-token' },
        body: {
          device_id: 'device-b',
          punches: [{ device_id: 'device-b', data_hora: '2026-06-14T10:00:00Z' }],
        },
      } as Request,
      res,
    );

    expect(status()).toBe(403);
    expect(body().code).toBe('DEVICE_INACTIVE');
  });

  it('TESTE 1b — token válido para device A rejeita punch com device B no lote', async () => {
    verifyRepAgentTokenVps.mockResolvedValue({ ok: true, method: 'device_key' });
    fetchRepDeviceCompanyId.mockResolvedValue('company-a');
    poolQuery.mockResolvedValue({ rows: [{ result: { success: false } }] });

    const { res, status, body } = captureRes();
    await repPunchesController(
      {
        headers: { authorization: 'Bearer device-a-token' },
        body: {
          device_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          punches: [
            {
              device_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              data_hora: '2026-06-14T10:00:00Z',
            },
          ],
        },
      } as Request,
      res,
    );

    expect(status()).toBe(200);
    const results = body().results as Array<Record<string, unknown>>;
    expect(results[0]?.error).toBe('device_id não pertence ao dispositivo autenticado');
  });

  it('TESTE 2 — devices possui escopo tenant na API genérica', () => {
    expect(tableHasTenantScope('devices')).toBe(true);
  });

  it('TESTE 2b — política marca devices como tenant-scoped', () => {
    expect(tableHasTenantScope('devices')).toBe(true);
  });

  it('TESTE 3 — INSERT user_settings com user_id de outro tenant retorna 403', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ company_id: 'company-b' }] });

    const { res, status, body } = captureRes();
    const req = {
      params: { table: 'user_settings' },
      body: { user_id: 'user-b', key: 'theme', value: {} },
      auth: { companyId: 'company-a', sub: 'admin-a', role: 'admin' },
      originalUrl: '/api/data/user_settings',
      method: 'POST',
    } as unknown as AuthedRequest;

    await insertDataController(req, res);

    expect(status()).toBe(403);
    expect(body().code).toBe('CROSS_TENANT_USER_REFERENCE');
  });

  it('TESTE 4 — global_settings sem token retorna 401 via authMiddleware', async () => {
    const { res, status } = captureRes();
    const req = { headers: {}, method: 'GET', originalUrl: '/api/data/global_settings' } as AuthedRequest;
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(status()).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('TESTE 4b — global_settings autenticado filtra por company_id', async () => {
    tableHasColumn.mockImplementation(async (table: string, column: string) => {
      if (table === 'global_settings' && column === 'company_id') return true;
      return true;
    });
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            { column_name: 'company_id', data_type: 'text', udt_name: 'text', is_generated: 'NEVER', is_identity: 'NO' },
          ],
        };
      }
      if (sql.includes('from public.global_settings')) {
        return { rows: [{ company_id: 'company-a' }] };
      }
      return { rows: [] };
    });

    const { res, status, body } = captureRes();
    const req = {
      auth: { companyId: 'company-a', sub: 'user-a', role: 'admin' },
    } as AuthedRequest;

    await authenticatedGlobalSettingsController(req, res);

    expect(status()).toBe(200);
    expect(body().data).toEqual([{ company_id: 'company-a' }]);
    const sqlCalls = poolQuery.mock.calls.map((call) => String(call[0]));
    expect(sqlCalls.some((sql) => sql.includes('where company_id::text = $1'))).toBe(true);
  });
});
