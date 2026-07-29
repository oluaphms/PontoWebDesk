// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolQuery = vi.fn();
const tableHasColumn = vi.fn();
const readCompanySessionGate = vi.fn();

vi.mock('../db/index.js', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}));

vi.mock('../db/schemaColumns.js', () => ({
  tableHasColumn: (...args: unknown[]) => tableHasColumn(...args),
}));

vi.mock('../master/commercial/companySessionRevocation.js', () => ({
  readCompanySessionGate: (...args: unknown[]) => readCompanySessionGate(...args),
}));

import { isRepDeviceOperational, verifyRepAgentTokenVps } from './repAgentAuthService.js';
import { ConfigService } from '../platform/configService.js';

describe('repAgentAuthService bridge hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REP_BRIDGE_TOKEN;
    delete process.env.REP_BRIDGE_LEGACY_ENABLED;
    delete process.env.API_KEY;
    ConfigService.resetCache();
    readCompanySessionGate.mockResolvedValue({
      commercialBlocked: false,
      commercialBlockReason: null,
      companySessionVersion: 0,
    });
    tableHasColumn.mockImplementation(async (table: string, column: string) => {
      if (column === 'ativo') return true;
      if (table === 'companies' && column === 'commercial_blocked') return true;
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
    expect(readCompanySessionGate).toHaveBeenCalledWith('company-a');
  });

  it('recusa bridge REP quando a empresa está bloqueada pelo Master', async () => {
    process.env.REP_BRIDGE_TOKEN = 'bridge-secret';
    readCompanySessionGate.mockResolvedValue({
      commercialBlocked: true,
      commercialBlockReason: 'license_validity_expired',
      companySessionVersion: 1,
    });

    await expect(verifyRepAgentTokenVps('bridge-secret', 'device-1')).resolves.toEqual({
      ok: false,
      code: 'DEVICE_INACTIVE',
    });
    expect(readCompanySessionGate).toHaveBeenCalledWith('company-a');
  });

  it('recusa device key quando a empresa está bloqueada pelo Master', async () => {
    readCompanySessionGate.mockResolvedValue({
      commercialBlocked: true,
      commercialBlockReason: 'license_validity_expired',
      companySessionVersion: 1,
    });
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('validate_device_key')) return { rows: [{ valid: true }] };
      if (sql.includes('from public.rep_devices')) {
        return { rows: [{ company_id: 'company-a', ativo: true }] };
      }
      if (sql.includes('from public.companies')) {
        return { rows: [{ id: 'company-a' }] };
      }
      return { rows: [] };
    });

    await expect(verifyRepAgentTokenVps('device-secret', 'device-1')).resolves.toEqual({
      ok: false,
      code: 'DEVICE_INACTIVE',
    });
  });

  it('reavalia vigência via gate (não depende só de commercial_blocked stale)', async () => {
    process.env.REP_BRIDGE_TOKEN = 'bridge-secret';
    readCompanySessionGate.mockResolvedValue({
      commercialBlocked: true,
      commercialBlockReason: 'license_not_started',
      companySessionVersion: 2,
    });
    expect(await isRepDeviceOperational('device-1')).toBe(false);
    expect(readCompanySessionGate).toHaveBeenCalled();
  });

  it('recusa bridge token quando REP_BRIDGE_LEGACY_ENABLED=false', async () => {
    process.env.REP_BRIDGE_TOKEN = 'bridge-secret';
    process.env.REP_BRIDGE_LEGACY_ENABLED = 'false';

    const result = await verifyRepAgentTokenVps('bridge-secret', 'device-1');

    expect(result).toEqual({ ok: false, code: 'unauthorized' });
  });

  it('isRepDeviceOperational retorna false sem company_id', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    expect(await isRepDeviceOperational('missing-device')).toBe(false);
  });
});
