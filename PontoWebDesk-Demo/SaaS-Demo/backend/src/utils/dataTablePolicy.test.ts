import { describe, expect, it } from 'vitest';
import { ALLOWED_TABLES, applyTenantToRow, isGenericDataApiWritesEnabled, isTableReadable, isTableWritable, tableHasTenantScope } from './dataTablePolicy.js';

describe('dataTablePolicy multi-tenant hardening', () => {
  it('desabilita writes genéricos em produção por default', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevWrites = process.env.DATA_API_WRITES_ENABLED;
    delete process.env.DATA_API_WRITES_ENABLED;
    process.env.NODE_ENV = 'production';
    expect(isGenericDataApiWritesEnabled()).toBe(false);
    process.env.DATA_API_WRITES_ENABLED = 'true';
    expect(isGenericDataApiWritesEnabled()).toBe(true);
    process.env.NODE_ENV = prevNodeEnv;
    process.env.DATA_API_WRITES_ENABLED = prevWrites;
  });

  it('mantém writes genéricos habilitados em desenvolvimento por default', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevWrites = process.env.DATA_API_WRITES_ENABLED;
    delete process.env.DATA_API_WRITES_ENABLED;
    process.env.NODE_ENV = 'development';
    expect(isGenericDataApiWritesEnabled()).toBe(true);
    process.env.NODE_ENV = prevNodeEnv;
    process.env.DATA_API_WRITES_ENABLED = prevWrites;
  });

  it('treats global_settings as tenant-scoped and readable by authenticated users', () => {
    expect(isTableReadable('global_settings', 'employee')).toBe(true);
    expect(isTableWritable('global_settings', 'employee')).toBe(false);
    expect(isTableWritable('global_settings', 'admin')).toBe(true);
    expect(tableHasTenantScope('global_settings')).toBe(true);
  });

  it('keeps companies outside generic tenant payload injection', () => {
    expect(isTableReadable('companies', 'admin')).toBe(true);
    expect(isTableReadable('companies', 'employee')).toBe(true);
    expect(tableHasTenantScope('companies')).toBe(false);
    expect(applyTenantToRow('companies', { name: 'Empresa B' }, 'company-a')).toEqual({ name: 'Empresa B' });
  });

  it('forces company_id on tenant tables and strips tenant_id aliases', () => {
    expect(
      applyTenantToRow('departments', { name: 'RH', company_id: 'other', tenant_id: 'other' }, 'company-a'),
    ).toEqual({ name: 'RH', company_id: 'company-a' });
  });

  it('scopes devices table by company_id for admin/hr', () => {
    expect(isTableReadable('devices', 'admin')).toBe(true);
    expect(isTableReadable('devices', 'employee')).toBe(false);
    expect(tableHasTenantScope('devices')).toBe(true);
    expect(
      applyTenantToRow('devices', { name: 'Relógio', company_id: 'other' }, 'company-a'),
    ).toEqual({ name: 'Relógio', company_id: 'company-a' });
  });

  it('keeps employees readable through the generic API for legacy dashboard links', () => {
    expect(ALLOWED_TABLES.has('employees')).toBe(true);
    expect(isTableReadable('employees', 'admin')).toBe(true);
    expect(tableHasTenantScope('employees')).toBe(true);
  });
});
