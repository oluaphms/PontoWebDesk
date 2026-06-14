// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolQuery = vi.fn();
const tableHasColumn = vi.fn();
const validateDeviceKeyHash = vi.fn();

vi.mock('../db/index.js', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}));

vi.mock('../db/schemaColumns.js', () => ({
  tableHasColumn: (...args: unknown[]) => tableHasColumn(...args),
}));

import { isRepDeviceOperational, verifyRepAgentTokenVps } from './repAgentAuthService.js';

describe('repAgentAuthService bridge hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REP_BRIDGE_TOKEN;
    delete process.env.API_KEY;
    tableHasColumn.mockImplementation(async (_table: string, column: string) => {
      if (column === 'ativo') return true;
      return false;
    });
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('validate_device_key')) return { rows: [{ valid: false }] };
      if (sql.includes('api_key::text')) return { rows: [{ api_key: '' }] };
      if (sql.includes('from public.rep_devices')) {
        return { rows: [{ company_id: 'company-a', ativo: true }] };
      }
      if (sql.includes('from public.companies')) {
        return { rowCount: 1, rows: [{ id: 'company-a' }] };
      }
      return { rows: [] };
    });
  });

  it('recusa bridge token quando device está inativo', async () => {
    process.env.REP_BRIDGE_TOKEN = 'bridge-secret';
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('validate_device_key')) return { rows: [{ valid: false }] };
      if (sql.includes('api_key::text')) return { rows: [{ api_key: '' }] };
      if (sql.includes('from public.rep_devices')) {
        return { rows: [{ company_id: 'company-a', ativo: false }] };
      }
      return { rows: [] };
    });

    const result = await verifyRepAgentTokenVps('bridge-secret', 'device-1');

    expect(result).toEqual({ ok: false, code: 'DEVICE_INACTIVE' });
  });

  it('aceita bridge token quando device e tenant estão ativos', async () => {
    process.env.REP_BRIDGE_TOKEN = 'bridge-secret';

    const result = await verifyRepAgentTokenVps('bridge-secret', 'device-1');

    expect(result).toEqual({ ok: true, method: 'bridge' });
  });

  it('isRepDeviceOperational retorna false sem company_id', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    expect(await isRepDeviceOperational('missing-device')).toBe(false);
  });
});
